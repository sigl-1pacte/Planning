// Port de src/server/app.js (Fastify) en Edge Function Supabase (Deno + Hono).
// Même routes, même schémas de validation, même logique métier — tout ce qui
// est réutilisé ci-dessous (linear/*, db/repo.js, shared/*, auth.js) est du
// JS pur sans dépendance Node, importé tel quel depuis src/server et
// src/shared. Seuls db.ts (pilote Postgres) et snapshotStore.ts (cache
// Linear, en base plutôt qu'en mémoire — une Edge Function n'a pas de
// process long-lived) sont propres à ce dossier ; voir leurs commentaires.
//
// Le serveur Fastify de src/server (npm run dev:server) reste le chemin de
// développement local : plus simple, plus rapide à itérer, aucune des
// contraintes d'une Edge Function. Ce fichier est ce qui tourne une fois
// déployé sur Supabase (voir README.md).
import { Hono } from 'npm:hono@4';
import { cors } from 'npm:hono/cors';
import Ajv from 'npm:ajv@8';

import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from '../../../src/server/linear/client.js';
import { dayOfWeek, isValidDate } from '../../../src/shared/calendar.js';
import * as repo from '../../../src/server/db/repo.js';
import { computeReschedule, RescheduleCycleError } from '../../../src/shared/reschedule.js';
import { setStartingDate, setContributors } from '../../../src/server/linear/parsing.js';
import { createKeyValidator } from '../../../src/server/auth.js';
import {
  fetchWorkspace, fetchIssuesSince, fetchViewer, fetchDiagnosticSample,
} from '../../../src/server/linear/queries.js';
import {
  updateIssue, createIssue, issueBlockers, addBlocker, removeBlocker,
  updateProject, createProject, createTeam, addComment, subscribeToIssue, updateMilestone,
} from '../../../src/server/linear/mutations.js';
import { buildDiagnostic } from '../../../src/server/diagnostic.js';
import { createPool } from './db.ts';
import { createSnapshotStore } from './snapshotStore.ts';

const linear = {
  updateIssue, createIssue, issueBlockers, addBlocker, removeBlocker,
  updateProject, createProject, createTeam, addComment, subscribeToIssue, updateMilestone,
};

const DATABASE_URL = Deno.env.get('SUPABASE_DB_URL') ?? Deno.env.get('DATABASE_URL');
if (!DATABASE_URL) throw new Error('SUPABASE_DB_URL (ou DATABASE_URL) absente.');
const db = createPool(DATABASE_URL);

const store = createSnapshotStore({
  fetchWorkspace: (key: string) => fetchWorkspace(key),
  fetchIssuesSince: (key: string, since: string) => fetchIssuesSince(key, since),
  onSync: async (domain: any) => {
    try { await repo.ensurePeople(db, domain.users.map((u: any) => u.id)); } catch (err) {
      console.error('Base de données inaccessible pendant la synchronisation :', (err as Error).message);
    }
  },
  onFullSync: async (domain: any) => {
    try {
      await repo.purgeContributions(
        db,
        domain.issues.flatMap((i: any) => i.contributorIds.map((linearUserId: string) => ({ issueId: i.id, linearUserId }))),
      );
    } catch (err) {
      console.error('Base de données inaccessible pendant la synchronisation :', (err as Error).message);
    }
  },
}, db);

const validateKey = createKeyValidator({ fetchViewer: (key: string) => fetchViewer(key) });

const AjvCtor: any = Ajv;
const ajv = new AjvCtor({ allErrors: false });
function assertValid(schema: object, body: unknown) {
  const validate = ajv.compile(schema);
  if (!validate(body)) {
    const msg = ajv.errorsText(validate.errors, { dataVar: 'body' });
    throw Object.assign(new Error(msg), { statusCode: 400 });
  }
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}
function assertIsoDay(value: string) {
  const m = ISO_RE.exec(value);
  if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw badRequest(`Date invalide : ${value}`);
}

async function withDatabase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err.statusCode) throw err;
    console.error(err);
    throw Object.assign(new Error('Base de données inaccessible'), { statusCode: 503 });
  }
}

const settingsBody = {
  type: 'object', required: ['hoursPerPoint', 'loadCeilingPct', 'defaultWeeklyHours'], additionalProperties: false,
  properties: {
    hoursPerPoint: { type: 'number', exclusiveMinimum: 0 },
    loadCeilingPct: { type: 'integer', minimum: 10, maximum: 200 },
    defaultWeeklyHours: { type: 'number', minimum: 0 },
  },
};
const personBody = {
  type: 'object', required: ['role', 'defaultWeeklyHours'], additionalProperties: false,
  properties: { role: { type: ['string', 'null'] }, defaultWeeklyHours: { type: ['number', 'null'], minimum: 0 } },
};
const capacityBody = {
  type: 'object', required: ['hours'], additionalProperties: false, properties: { hours: { type: 'number', minimum: 0 } },
};
const contributionsBody = {
  type: 'object', required: ['shares'], additionalProperties: false,
  properties: {
    shares: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['linearUserId', 'share'], additionalProperties: false,
        properties: { linearUserId: { type: 'string', minLength: 1 }, share: { type: 'number', minimum: 0 } },
      },
    },
  },
};
const holidayBody = {
  type: 'object', required: ['day', 'label'], additionalProperties: false,
  properties: { day: { type: 'string' }, label: { type: 'string', minLength: 1 } },
};
const issuePatchBody = {
  type: 'object', minProperties: 1, additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    assigneeId: { type: ['string', 'null'] },
    estimate: { type: ['number', 'null'], minimum: 0 },
    stateId: { type: 'string', minLength: 1 },
    start: { type: 'string' },
    end: { type: 'string' },
  },
};
const rescheduleBody = {
  type: 'object', minProperties: 1, additionalProperties: false,
  properties: { start: { type: 'string' }, end: { type: 'string' } },
};
const dependenciesBody = {
  type: 'object', required: ['blockedBy'], additionalProperties: false,
  properties: { blockedBy: { type: 'array', items: { type: 'string' } } },
};
const contributorsBody = {
  type: 'object', required: ['contributorIds'], additionalProperties: false,
  properties: { contributorIds: { type: 'array', items: { type: 'string' } } },
};
const issueCreateBody = {
  type: 'object', required: ['teamId', 'title'], additionalProperties: false,
  properties: {
    teamId: { type: 'string', minLength: 1 },
    projectId: { type: ['string', 'null'] },
    title: { type: 'string', minLength: 1 },
    estimate: { type: ['number', 'null'], minimum: 0 },
  },
};
const projectPatchBody = {
  type: 'object', minProperties: 1, additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 }, color: { type: 'string' },
    startDate: { type: 'string' }, targetDate: { type: 'string' },
  },
};
const milestoneBody = {
  type: 'object', required: ['targetDate'], additionalProperties: false, properties: { targetDate: { type: 'string' } },
};
const projectCreateBody = {
  type: 'object', required: ['teamIds', 'name'], additionalProperties: false,
  properties: { teamIds: { type: 'array', minItems: 1, items: { type: 'string' } }, name: { type: 'string', minLength: 1 } },
};
const teamCreateBody = {
  type: 'object', required: ['key', 'name'], additionalProperties: false,
  properties: { key: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 } },
};

type Vars = { linearKey: string; viewer: unknown };
// Supabase retire le préfixe /functions/v1 avant de transmettre la requête
// à la fonction, mais garde son propre nom en premier segment du chemin
// (vérifié en déployant une fonction de diagnostic qui renvoyait req.url) :
// une requête à .../functions/v1/api/api/health arrive ici en /api/api/health,
// pas en /functions/v1/api/api/health.
const app = new Hono<{ Variables: Vars }>().basePath('/api');

app.use('/api/*', cors({
  origin: (Deno.env.get('ALLOWED_ORIGIN') ?? '*').split(',').map((s) => s.trim()),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'x-linear-key'],
}));

app.onError((err: any, c) => {
  if (err instanceof LinearAuthError) return c.json({ error: err.message }, 401);
  if (err instanceof LinearRateLimitError || err instanceof LinearUnavailableError) return c.json({ error: err.message }, 503);
  if (err.statusCode && err.statusCode < 600) return c.json({ error: err.message }, err.statusCode);
  console.error(err);
  return c.json({ error: 'Erreur interne' }, 500);
});

// La clé Linear personnelle (en-tête x-linear-key), pas un JWT Supabase —
// verify_jwt = false pour cette fonction (voir supabase/config.toml).
app.use('/api/*', async (c, next) => {
  if (c.req.path.endsWith('/api/health')) return next();
  const linearKey = c.req.header('x-linear-key') ?? '';
  const viewer = await validateKey(linearKey);
  c.set('linearKey', linearKey);
  c.set('viewer', viewer);
  return next();
});

app.get('/api/health', async (c) => {
  try {
    await db.query('select 1');
    return c.json({ status: 'ok', database: 'ok' });
  } catch {
    return c.json({ status: 'degraded', database: 'inaccessible' }, 503);
  }
});

app.post('/api/key/validate', (c) => c.json({ user: c.get('viewer') }));

app.get('/api/snapshot', async (c) => {
  const key = c.get('linearKey');
  const snap = await store.get(key);
  const sinceParam = c.req.query('since');
  const since = sinceParam === undefined ? null : Number(sinceParam);
  return c.json(since === snap.version ? { ...snap, domain: null } : snap);
});

app.post('/api/refresh', async (c) => c.json(await store.forceRefresh(c.get('linearKey'), { full: true })));

app.get('/api/planning', async (c) => c.json(await withDatabase(() => repo.getPlanning(db))));

app.put('/api/settings', async (c) => {
  const body = await c.req.json();
  assertValid(settingsBody, body);
  return c.json(await withDatabase(async () => { await repo.updateSettings(db, body); return repo.getPlanning(db); }));
});

app.put('/api/people/:linearUserId', async (c) => {
  const body = await c.req.json();
  assertValid(personBody, body);
  return c.json(await withDatabase(async () => {
    await repo.updatePerson(db, c.req.param('linearUserId'), body);
    return repo.getPlanning(db);
  }));
});

app.put('/api/people/:linearUserId/capacity/:weekStart', async (c) => {
  const body = await c.req.json();
  assertValid(capacityBody, body);
  const { linearUserId, weekStart } = c.req.param();
  return c.json(await withDatabase(async () => {
    assertIsoDay(weekStart);
    if (dayOfWeek(weekStart) !== 1) throw badRequest(`${weekStart} n'est pas un lundi`);
    await repo.setWeeklyCapacity(db, linearUserId, weekStart, (body as any).hours);
    return repo.getPlanning(db);
  }));
});

app.delete('/api/people/:linearUserId/capacity/:weekStart', async (c) => {
  const { linearUserId, weekStart } = c.req.param();
  return c.json(await withDatabase(async () => {
    assertIsoDay(weekStart);
    await repo.deleteWeeklyCapacity(db, linearUserId, weekStart);
    return repo.getPlanning(db);
  }));
});

app.put('/api/issues/:issueId/contributions', async (c) => {
  const body: any = await c.req.json();
  assertValid(contributionsBody, body);
  const ids = body.shares.map((s: any) => s.linearUserId);
  if (new Set(ids).size !== ids.length) throw badRequest('Une personne apparaît deux fois dans les parts');
  return c.json(await withDatabase(async () => {
    await repo.setContributions(db, c.req.param('issueId'), body.shares);
    return repo.getPlanning(db);
  }));
});

app.delete('/api/issues/:issueId/contributions', async (c) => c.json(await withDatabase(async () => {
  await repo.clearContributions(db, c.req.param('issueId'));
  return repo.getPlanning(db);
})));

app.post('/api/holidays', async (c) => {
  const body: any = await c.req.json();
  assertValid(holidayBody, body);
  return c.json(await withDatabase(async () => {
    assertIsoDay(body.day);
    await repo.addHoliday(db, body.day, body.label);
    return repo.getPlanning(db);
  }));
});

app.delete('/api/holidays/:day', async (c) => c.json(await withDatabase(async () => {
  assertIsoDay(c.req.param('day'));
  await repo.deleteHoliday(db, c.req.param('day'));
  return repo.getPlanning(db);
})));

app.put('/api/issues/:issueId', async (c) => {
  const body: any = await c.req.json();
  assertValid(issuePatchBody, body);
  const key = c.get('linearKey');
  const patch: any = { ...body };
  if ('start' in patch) {
    const current = await store.current();
    const issue = current?.domain.issues.find((i: any) => i.id === c.req.param('issueId'));
    patch.description = setStartingDate(issue?.rawDescription ?? null, patch.start);
    delete patch.start;
  }
  if ('end' in patch) {
    patch.dueDate = patch.end;
    delete patch.end;
  }
  await linear.updateIssue(key, c.req.param('issueId'), patch);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.post('/api/issues/:issueId/reschedule', async (c) => {
  const body: any = await c.req.json();
  assertValid(rescheduleBody, body);
  const key = c.get('linearKey');
  const current = await store.current();
  if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
  let changes;
  try {
    changes = computeReschedule(current.domain.issues, new Set(), c.req.param('issueId'), body);
  } catch (err: any) {
    throw Object.assign(err, { statusCode: 400 });
  }
  const byId = new Map(current.domain.issues.map((i: any) => [i.id, i]));
  for (const change of changes as any[]) {
    const issue: any = byId.get(change.issueId);
    await linear.updateIssue(key, change.issueId, {
      description: setStartingDate(issue?.rawDescription ?? null, change.newStart),
      dueDate: change.newEnd,
    });
  }
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain, changes });
});

app.put('/api/issues/:issueId/dependencies', async (c) => {
  const body: any = await c.req.json();
  assertValid(dependenciesBody, body);
  const key = c.get('linearKey');
  const issueId = c.req.param('issueId');
  const current = await linear.issueBlockers(key, issueId);
  const desired: Set<string> = new Set(body.blockedBy);
  const existing = new Set(current.map((cur: any) => cur.blockerId));
  for (const { relationId, blockerId } of current as any[]) {
    if (!desired.has(blockerId)) await linear.removeBlocker(key, relationId);
  }
  for (const blockerId of desired) {
    if (!existing.has(blockerId)) await linear.addBlocker(key, issueId, blockerId);
  }
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.put('/api/issues/:issueId/contributors', async (c) => {
  const body: any = await c.req.json();
  assertValid(contributorsBody, body);
  const key = c.get('linearKey');
  const current = await store.current();
  if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
  const issue = current.domain.issues.find((i: any) => i.id === c.req.param('issueId'));
  if (!issue) throw Object.assign(new Error('Issue inconnue'), { statusCode: 404 });
  const byId = new Map(current.domain.users.map((u: any) => [u.id, u]));
  const selected = body.contributorIds.map((id: string) => byId.get(id)).filter(Boolean);
  await linear.updateIssue(key, issue.id, { description: setContributors(issue.rawDescription, selected) });
  const added = body.contributorIds.filter((id: string) => !issue.contributorIds.includes(id));
  const addedUsers = added.map((id: string) => byId.get(id)).filter(Boolean);
  if (addedUsers.length) {
    const names = addedUsers.map((u: any) => u.name).join(', ');
    await linear.addComment(key, issue.id, `Ajouté·e·s comme contributeurs : ${names}`);
    for (const u of addedUsers as any[]) await linear.subscribeToIssue(key, issue.id, u.id);
  }
  await repo.pruneContributions(db, issue.id, body.contributorIds);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.post('/api/issues', async (c) => {
  const body: any = await c.req.json();
  assertValid(issueCreateBody, body);
  const key = c.get('linearKey');
  const issue = await linear.createIssue(key, body);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain, issueId: issue.id });
});

app.put('/api/projects/:projectId', async (c) => {
  const body: any = await c.req.json();
  assertValid(projectPatchBody, body);
  const key = c.get('linearKey');
  await linear.updateProject(key, c.req.param('projectId'), body);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.put('/api/milestones/:milestoneId', async (c) => {
  const body: any = await c.req.json();
  assertValid(milestoneBody, body);
  const key = c.get('linearKey');
  await linear.updateMilestone(key, c.req.param('milestoneId'), { targetDate: body.targetDate });
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.post('/api/projects', async (c) => {
  const body: any = await c.req.json();
  assertValid(projectCreateBody, body);
  const key = c.get('linearKey');
  const project = await linear.createProject(key, body);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain, projectId: project.id });
});

app.post('/api/teams', async (c) => {
  const body: any = await c.req.json();
  assertValid(teamCreateBody, body);
  const key = c.get('linearKey');
  await linear.createTeam(key, body);
  const snap = await store.forceRefresh(key);
  return c.json({ domain: snap.domain });
});

app.get('/api/diagnostic', async (c) => {
  const requested = Number(c.req.query('limit') ?? 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 20));
  return c.json(buildDiagnostic(await fetchDiagnosticSample(c.get('linearKey'), limit)));
});

Deno.serve(app.fetch);
