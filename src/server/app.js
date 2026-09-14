import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from './linear/client.js';
import { dayOfWeek, isValidDate } from '../shared/calendar.js';
import * as repo from './db/repo.js';

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
      throw Object.assign(new Error(`Base de données inaccessible : ${err.message}`), { statusCode: 503 });
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

export function buildApp({ db, store, validateKey, staticDir = null, logger = false }) {
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
    if (!req.url.startsWith('/api/') || req.url === '/api/health') return;
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

  app.post('/api/refresh', async (req) => store.forceRefresh(req.linearKey));

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

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}
