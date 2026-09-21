import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from './linear/client.js';
import { dayOfWeek, isValidDate } from '../shared/calendar.js';
import * as repo from './db/repo.js';
import { computeReschedule, RescheduleCycleError } from '../shared/reschedule.js';
import { setStartingDate, setContributors } from './linear/parsing.js';
import { refreshUntil } from './sync/refreshUntil.js';
import { createIssueWithExtras, buildProjectInput, buildMilestoneInput, withMove } from './linear/createFlow.js';

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
    stateId: { type: 'string', minLength: 1 },
    teamId: { type: 'string', minLength: 1 },
    projectId: { type: ['string', 'null'], minLength: 1 },
    start: { type: 'string' },
    end: { type: 'string' },
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
    start: { type: 'string' },
    end: { type: 'string' },
    assigneeId: { type: 'string', minLength: 1 },
    stateId: { type: 'string', minLength: 1 },
    blockedBy: { type: 'array', items: { type: 'string', minLength: 1 } },
    contributorIds: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

// La suppression exige que le client renvoie l'identifiant de la tâche (ou le
// nom du projet) : le serveur le compare à Linear. Un appel qui ne l'a pas
// tapé explicitement — script, requête rejouée, mauvais id — est refusé.
const deleteBody = {
  type: 'object',
  required: ['confirm'],
  additionalProperties: false,
  properties: { confirm: { type: 'string', minLength: 1 } },
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

const milestoneBody = {
  type: 'object',
  required: ['targetDate'],
  additionalProperties: false,
  properties: { targetDate: { type: 'string' } },
};

const milestoneCreateBody = {
  type: 'object',
  required: ['projectId', 'name'],
  additionalProperties: false,
  properties: {
    projectId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
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
    startDate: { type: 'string' },
    targetDate: { type: 'string' },
    color: { type: 'string' },
  },
};

const teamCreateBody = {
  type: 'object',
  required: ['key', 'name'],
  additionalProperties: false,
  properties: { key: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 } },
};

export function buildApp({ db, store, validateKey, linear, staticDir = null, logger = false, refreshDelayMs = 400 }) {
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
    // start/end ici ne passent PAS par la cascade (contrairement à
    // POST .../reschedule) : glisser un bord de barre ne modifie que cette
    // date-là, sans décaler les dépendantes. start vit dans la description
    // (comme ailleurs) ; end est directement le champ natif dueDate.
    const current = store.current();
    const issue = current?.domain.issues.find((i) => i.id === req.params.issueId);
    // Changement de team / de projet : statut et projet réalignés côté serveur.
    const patch = withMove({ ...req.body }, issue, current?.domain ?? null);
    if ('start' in patch) {
      patch.description = setStartingDate(issue?.rawDescription ?? null, patch.start);
      delete patch.start;
    }
    if ('end' in patch) {
      patch.dueDate = patch.end;
      delete patch.end;
    }
    await linear.updateIssue(req.linearKey, req.params.issueId, patch);
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
    // défaut) — en texte lisible, sans dépendre d'une conversion en mention
    // (une URL de profil en clair peut sembler devenir une mention à
    // l'affichage sans réellement abonner qui que ce soit : retours
    // documentés de la communauté Linear, github.com/linear/linear/issues/351).
    // L'abonnement réel passe par issueSubscribe, la route dédiée à ça —
    // indépendante du rendu d'un texte, donc fiable.
    const added = req.body.contributorIds.filter((id) => !issue.contributorIds.includes(id));
    const addedUsers = added.map((id) => byId.get(id)).filter(Boolean);
    if (addedUsers.length) {
      const names = addedUsers.map((u) => u.name).join(', ');
      await linear.addComment(req.linearKey, issue.id, `Ajouté·e·s comme contributeurs : ${names}`);
      for (const u of addedUsers) await linear.subscribeToIssue(req.linearKey, issue.id, u.id);
    }
    // Linear reste la source de vérité pour qui est contributeur : une part
    // en base pour quelqu'un qu'on vient de retirer ne doit pas survivre
    // jusqu'au prochain cycle complet de synchronisation.
    await repo.pruneContributions(db, issue.id, req.body.contributorIds);
    const snap = await store.forceRefresh(req.linearKey);
    return { domain: snap.domain };
  });

  app.post('/api/issues', { schema: { body: issueCreateBody } }, async (req) => {
    // Tout ce qui peut être refusé l'est avant le premier appel vers Linear
    // (voir linear/createFlow.js) : start/end, statut, contributeurs, etc.
    const { issue, warnings } = await createIssueWithExtras({
      linear, key: req.linearKey, body: req.body, domain: store.current()?.domain ?? null,
    });
    const snap = await refreshUntil(store, req.linearKey, (d) => d.issues.some((i) => i.id === issue.id), { delayMs: refreshDelayMs });
    return { domain: snap.domain, issueId: issue.id, warnings };
  });

  app.delete('/api/issues/:issueId', { schema: { body: deleteBody } }, async (req) => {
    const current = store.current();
    if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
    const issue = current.domain.issues.find((i) => i.id === req.params.issueId);
    if (!issue) throw Object.assign(new Error('Tâche introuvable'), { statusCode: 404 });
    if (req.body.confirm !== issue.identifier) throw badRequest('Confirmation incorrecte : saisissez l\'identifiant de la tâche');
    await linear.deleteIssue(req.linearKey, issue.id);
    const snap = await refreshUntil(store, req.linearKey, (d) => !d.issues.some((i) => i.id === issue.id), { delayMs: refreshDelayMs });
    return { domain: snap.domain };
  });

  app.delete('/api/projects/:projectId', { schema: { body: deleteBody } }, async (req) => {
    const current = store.current();
    if (!current) throw Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
    const project = current.domain.projects.find((p) => p.id === req.params.projectId);
    if (!project) throw Object.assign(new Error('Projet introuvable'), { statusCode: 404 });
    if (req.body.confirm !== project.name) throw badRequest('Confirmation incorrecte : saisissez le nom du projet');
    await linear.deleteProject(req.linearKey, project.id);
    // Les tâches du projet restent dans Linear (elles n'ont simplement plus de
    // projet) : la synchronisation complète les relit toutes.
    const snap = await refreshUntil(store, req.linearKey, (d) => !d.projects.some((p) => p.id === project.id), { delayMs: refreshDelayMs });
    return { domain: snap.domain };
  });

  app.put('/api/projects/:projectId', { schema: { body: projectPatchBody } }, async (req) => {
    await linear.updateProject(req.linearKey, req.params.projectId, req.body);
    // Synchronisation complète : un cycle incrémental ne relit que les issues,
    // pas les projets (nom, dates, couleur, jalons).
    const snap = await store.forceRefresh(req.linearKey, { full: true });
    return { domain: snap.domain };
  });

  app.put('/api/milestones/:milestoneId', { schema: { body: milestoneBody } }, async (req) => {
    await linear.updateMilestone(req.linearKey, req.params.milestoneId, { targetDate: req.body.targetDate });
    const snap = await store.forceRefresh(req.linearKey, { full: true });
    return { domain: snap.domain };
  });

  app.post('/api/milestones', { schema: { body: milestoneCreateBody } }, async (req) => {
    const input = buildMilestoneInput(req.body, store.current()?.domain ?? null);
    const milestone = await linear.createMilestone(req.linearKey, input);
    // Synchronisation complète : un cycle incrémental ne relit que les issues,
    // pas les jalons des projets.
    const snap = await refreshUntil(
      store, req.linearKey,
      (d) => d.projects.some((p) => p.milestones.some((m) => m.id === milestone.id)),
      { delayMs: refreshDelayMs },
    );
    return { domain: snap.domain, milestoneId: milestone.id };
  });

  app.post('/api/projects', { schema: { body: projectCreateBody } }, async (req) => {
    // Synchronisation complète : un cycle incrémental ne relit que les issues,
    // jamais la liste des projets ni des teams (rafraîchie seulement toutes
    // les dix minutes), donc un projet ou une team créés n'y apparaîtraient pas.
    const project = await linear.createProject(req.linearKey, buildProjectInput(req.body));
    const snap = await refreshUntil(store, req.linearKey, (d) => d.projects.some((p) => p.id === project.id), { delayMs: refreshDelayMs });
    return { domain: snap.domain, projectId: project.id };
  });

  app.post('/api/teams', { schema: { body: teamCreateBody } }, async (req) => {
    const team = await linear.createTeam(req.linearKey, req.body);
    const snap = await refreshUntil(store, req.linearKey, (d) => !team?.id || d.teams.some((t) => t.id === team.id), { delayMs: refreshDelayMs });
    return { domain: snap.domain };
  });

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}
