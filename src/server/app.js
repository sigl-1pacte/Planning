import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from './linear/client.js';
import { dayOfWeek, isValidDate } from '../shared/calendar.js';
import * as repo from './db/repo.js';
import { computeReschedule, RescheduleCycleError } from '../shared/reschedule.js';
import { setStartingDate, setContributors } from './linear/parsing.js';
import { mentionUrl } from './linear/mutations.js';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function assertIsoDay(value) {
  const m = ISO_RE.exec(value);
  if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
    throw badRequest(`Date invalide : ${value}`);
  }
}

function withDatabase(handler) {
  return async (req, reply) => {
    try {
      return await handler(req, reply);
    } catch (err) {
      if (err.statusCode) throw err;
      req.log.error(err);
      throw Object.assign(new Error('Base de données inaccessible'), { statusCode: 503 });
    }
  };
}

const settingsBody = {
  type: 'object',
  required: ['hoursPerPoint', 'loadCeilingPct', 'defaultWeeklyHours'],
  additionalProperties: false,
  properties: {
    hoursPerPoint: { type: 'number', exclusiveMinimum: 0 },
    loadCeilingPct: { type: 'integer', minimum: 10, maximum: 200 },
    defaultWeeklyHours: { type: 'number', minimum: 0 },
  },
};

const personBody = {
  type: 'object',
  required: ['role', 'defaultWeeklyHours'],
  additionalProperties: false,
  properties: {
    role: { type: ['string', 'null'] },
    defaultWeeklyHours: { type: ['number', 'null'], minimum: 0 },
  },
};

const capacityBody = {
  type: 'object',
  required: ['hours'],
  additionalProperties: false,
  properties: { hours: { type: 'number', minimum: 0 } },
};

const contributionsBody = {
  type: 'object',
  required: ['shares'],
  additionalProperties: false,
  properties: {
    shares: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['linearUserId', 'share'],
        additionalProperties: false,
        properties: {
          linearUserId: { type: 'string', minLength: 1 },
          share: { type: 'number', minimum: 0 },
        },
      },
    },
  },
};

const holidayBody = {
  type: 'object',
  required: ['day', 'label'],
  additionalProperties: false,
  properties: {
    day: { type: 'string' },
    label: { type: 'string', minLength: 1 },
  },
};

const issuePatchBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    assigneeId: { type: ['string', 'null'] },
    estimate: { type: ['number', 'null'], minimum: 0 },
  },
};

const rescheduleBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: { start: { type: 'string' }, end: { type: 'string' } },
};

const dependenciesBody = {
  type: 'object',
  required: ['blockedBy'],
  additionalProperties: false,
  properties: { blockedBy: { type: 'array', items: { type: 'string' } } },
};

const contributorsBody = {
  type: 'object',
  required: ['contributorIds'],
  additionalProperties: false,
  properties: { contributorIds: { type: 'array', items: { type: 'string' } } },
};

const issueCreateBody = {
  type: 'object',
  required: ['teamId', 'title'],
  additionalProperties: false,
  properties: {
    teamId: { type: 'string', minLength: 1 },
    projectId: { type: ['string', 'null'] },
    title: { type: 'string', minLength: 1 },
    estimate: { type: ['number', 'null'], minimum: 0 },
  },
};

const projectPatchBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    color: { type: 'string' },
    startDate: { type: 'string' },
    targetDate: { type: 'string' },
  },
};

const projectCreateBody = {
  type: 'object',
  required: ['teamIds', 'name'],
  additionalProperties: false,
  properties: {
    teamIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    name: { type: 'string', minLength: 1 },
  },
};

const teamCreateBody = {
  type: 'object',
  required: ['key', 'name'],
  additionalProperties: false,
  properties: { key: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 } },
};

export function buildApp({ db, store, validateKey, linear, staticDir = null, logger = false }) {
  const app = Fastify({ logger });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof LinearAuthError) return reply.code(401).send({ error: err.message });
    if (err instanceof LinearRateLimitError || err instanceof LinearUnavailableError) {
      return reply.code(503).send({ error: err.message });
    }
    if (err.validation) return reply.code(400).send({ error: err.message });
    if (err.statusCode && err.statusCode < 600) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Erreur interne' });
  });

  app.addHook('onRequest', async (req) => {
    // Décide sur le motif de route résolu (chemin décodé) et non sur l'URL brute :
    // « /%61pi/planning » atteint la route /api/planning et doit exiger la clé.
    const route = req.routeOptions?.url;
    if (!route || !route.startsWith('/api/') || route === '/api/health') return;
    req.linearKey = req.headers['x-linear-key'];
    req.viewer = await validateKey(req.linearKey);
  });

  app.get('/api/health', async (req, reply) => {
    try {
      await db.query('select 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'inaccessible' });
    }
  });

  app.post('/api/key/validate', async (req) => ({ user: req.viewer }));

  app.get('/api/snapshot', async (req) => {
    const snap = await store.get(req.linearKey);
    const since = req.query.since === undefined ? null : Number(req.query.since);
    return since === snap.version ? { ...snap, domain: null } : snap;
  });

  app.post('/api/refresh', async (req) => store.forceRefresh(req.linearKey, { full: true }));

  app.get('/api/planning', withDatabase(async () => repo.getPlanning(db)));

  app.put('/api/settings', { schema: { body: settingsBody } }, withDatabase(async (req) => {
    await repo.updateSettings(db, req.body);
    return repo.getPlanning(db);
  }));

  app.put('/api/people/:linearUserId', { schema: { body: personBody } }, withDatabase(async (req) => {
    await repo.updatePerson(db, req.params.linearUserId, req.body);
    return repo.getPlanning(db);
  }));

  app.put('/api/people/:linearUserId/capacity/:weekStart', { schema: { body: capacityBody } }, withDatabase(async (req) => {
    const { linearUserId, weekStart } = req.params;
    assertIsoDay(weekStart);
    if (dayOfWeek(weekStart) !== 1) throw badRequest(`${weekStart} n'est pas un lundi`);
    await repo.setWeeklyCapacity(db, linearUserId, weekStart, req.body.hours);
    return repo.getPlanning(db);
  }));

  app.delete('/api/people/:linearUserId/capacity/:weekStart', withDatabase(async (req) => {
    assertIsoDay(req.params.weekStart);
    await repo.deleteWeeklyCapacity(db, req.params.linearUserId, req.params.weekStart);
    return repo.getPlanning(db);
  }));

  app.put('/api/issues/:issueId/contributions', { schema: { body: contributionsBody } }, withDatabase(async (req) => {
    const ids = req.body.shares.map((s) => s.linearUserId);
    if (new Set(ids).size !== ids.length) throw badRequest('Une personne apparaît deux fois dans les parts');
    await repo.setContributions(db, req.params.issueId, req.body.shares);
    return repo.getPlanning(db);
  }));

  app.delete('/api/issues/:issueId/contributions', withDatabase(async (req) => {
    await repo.clearContributions(db, req.params.issueId);
    return repo.getPlanning(db);
  }));

  app.post('/api/holidays', { schema: { body: holidayBody } }, withDatabase(async (req) => {
    assertIsoDay(req.body.day);
    await repo.addHoliday(db, req.body.day, req.body.label);
    return repo.getPlanning(db);
  }));

  app.delete('/api/holidays/:day', withDatabase(async (req) => {
    assertIsoDay(req.params.day);
    await repo.deleteHoliday(db, req.params.day);
    return repo.getPlanning(db);
  }));

  app.put('/api/issues/:issueId', { schema: { body: issuePatchBody } }, async (req) => {
    await linear.updateIssue(req.linearKey, req.params.issueId, req.body);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  app.post('/api/issues/:issueId/reschedule', { schema: { body: rescheduleBody } }, async (req) => {
    const current = store.current();
    if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
    let changes;
    try {
      // Jours chômés non lus depuis la base ici : la cascade ignore les jours fériés
      // pour ce lot. Remplacer par les jours chômés de repo.getPlanning(db) si ça gêne.
      changes = computeReschedule(current.domain.issues, new Set(), req.params.issueId, req.body);
    } catch (err) {
      if (err instanceof RescheduleCycleError) throw Object.assign(err, { statusCode: 400 });
      throw Object.assign(err, { statusCode: 400 });
    }
    const byId = new Map(current.domain.issues.map((i) => [i.id, i]));
    for (const change of changes) {
      const issue = byId.get(change.issueId);
      // setStartingDate ne remplace que la ligne « Starting date » (issue.rawDescription
      // porte le reste, Contributors compris) ; si l'issue n'a jamais eu de ligne
      // lisible, elle est ajoutée en tête sans rien perdre du reste de la description.
      await linear.updateIssue(req.linearKey, change.issueId, {
        description: setStartingDate(issue?.rawDescription ?? null, change.newStart),
        dueDate: change.newEnd,
      });
    }
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain, changes };
  });

  app.put('/api/issues/:issueId/dependencies', { schema: { body: dependenciesBody } }, async (req) => {
    const current = await linear.issueBlockers(req.linearKey, req.params.issueId);
    const desired = new Set(req.body.blockedBy);
    const existing = new Set(current.map((c) => c.blockerId));
    for (const { relationId, blockerId } of current) {
      if (!desired.has(blockerId)) await linear.removeBlocker(req.linearKey, relationId);
    }
    for (const blockerId of desired) {
      if (!existing.has(blockerId)) await linear.addBlocker(req.linearKey, req.params.issueId, blockerId);
    }
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  app.put('/api/issues/:issueId/contributors', { schema: { body: contributorsBody } }, async (req) => {
    const current = store.current();
    if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
    const issue = current.domain.issues.find((i) => i.id === req.params.issueId);
    if (!issue) throw Object.assign(new Error('Issue inconnue'), { statusCode: 404 });
    const byId = new Map(current.domain.users.map((u) => [u.id, u]));
    const selected = req.body.contributorIds.map((id) => byId.get(id)).filter(Boolean);
    await linear.updateIssue(req.linearKey, issue.id, {
      description: setContributors(issue.rawDescription, selected),
    });
    // Un commentaire identifie les nouveaux contributeurs (ceux qui ne
    // portaient pas déjà la charge, contributeur explicite ou assigné par
    // défaut). Un simple texte « @nom » posté via l'API n'est pas converti
    // en mention par Linear (seul son éditeur le fait) : on utilise l'URL de
    // profil en clair, que Linear convertit bien en mention identifiante à
    // l'affichage — voir mentionUrl.
    const added = req.body.contributorIds.filter((id) => !issue.contributorIds.includes(id));
    if (added.length && req.viewer?.organization?.urlKey) {
      const urlKey = req.viewer.organization.urlKey;
      const mentions = added.map((id) => byId.get(id)).filter(Boolean).map((u) => mentionUrl(urlKey, u)).join(' ');
      if (mentions) await linear.addComment(req.linearKey, issue.id, `Ajouté·e·s comme contributeurs : ${mentions}`);
    }
    // Linear reste la source de vérité pour qui est contributeur : une part
    // en base pour quelqu'un qu'on vient de retirer ne doit pas survivre
    // jusqu'au prochain cycle complet de synchronisation.
    await repo.pruneContributions(db, issue.id, req.body.contributorIds);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  app.post('/api/issues', { schema: { body: issueCreateBody } }, async (req) => {
    const issue = await linear.createIssue(req.linearKey, req.body);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain, issueId: issue.id };
  });

  app.put('/api/projects/:projectId', { schema: { body: projectPatchBody } }, async (req) => {
    await linear.updateProject(req.linearKey, req.params.projectId, req.body);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  app.post('/api/projects', { schema: { body: projectCreateBody } }, async (req) => {
    const project = await linear.createProject(req.linearKey, req.body);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain, projectId: project.id };
  });

  app.post('/api/teams', { schema: { body: teamCreateBody } }, async (req) => {
    await linear.createTeam(req.linearKey, req.body);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}
