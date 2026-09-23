import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createTestDb } from '../helpers/db.js';
import { setContributions, getPlanning } from '../../src/server/db/repo.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';
import { LinearAuthError, LinearUnavailableError } from '../../src/server/linear/client.js';

const KEY = { 'x-linear-key': 'good' };
const snap = {
  version: 3, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null,
  domain: mapWorkspace(rawWorkspace()),
};

let app;
let db;
let store;

beforeEach(async () => {
  db = await createTestDb();
  // store.current() renvoie l'instantané courant en mémoire (déjà présent dans la
  // vraie snapshotStore du sous-projet 1) ; on l'ajoute ici au mock car les
  // nouvelles routes d'écriture (décalage) le lisent de façon synchrone.
  store = { get: vi.fn(async () => snap), forceRefresh: vi.fn(async () => snap), current: vi.fn(() => snap) };
  const validateKey = async (key) => {
    if (key !== 'good') throw new LinearAuthError();
    return { id: 'u-sacha', name: 'Sacha', email: 'sacha@ex.fr' };
  };
  app = buildApp({ db, store, validateKey });
  await app.ready();
});

afterEach(() => app.close());

const call = (method, url, payload, headers = KEY) => app.inject({ method, url, payload, headers });

describe('authentification', () => {
  it('laisse passer /api/health sans clé', async () => {
    const res = await call('GET', '/api/health', undefined, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('refuse une clé absente ou invalide', async () => {
    expect((await call('GET', '/api/planning', undefined, {})).statusCode).toBe(401);
    const res = await call('GET', '/api/planning', undefined, { 'x-linear-key': 'bad' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Clé Linear invalide ou révoquée' });
  });

  it('refuse sans clé les chemins /api encodés en pourcentage', async () => {
    expect((await call('GET', '/%61pi/planning', undefined, {})).statusCode).toBe(401);
    expect((await call('GET', '/ap%69/snapshot', undefined, {})).statusCode).toBe(401);
    const put = await call('PUT', '/%61pi/settings', { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 }, {});
    expect(put.statusCode).toBe(401);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('laisse passer /api/health avec une query string sans clé', async () => {
    expect((await call('GET', '/api/health?x=1', undefined, {})).statusCode).toBe(200);
  });

  it('renvoie l’utilisateur Linear de la clé', async () => {
    expect((await call('POST', '/api/key/validate')).json()).toEqual({
      user: { id: 'u-sacha', name: 'Sacha', email: 'sacha@ex.fr' },
    });
  });
});

describe('santé', () => {
  it('signale une base inaccessible', async () => {
    const broken = { query: async () => { throw new Error('ECONNREFUSED'); } };
    const other = buildApp({ db: broken, store, validateKey: async () => ({}) });
    const res = await other.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', database: 'inaccessible' });
    await other.close();
  });

  it('répond 503 avec un message explicite si la base tombe sur une route de planification', async () => {
    const broken = { query: async () => { throw new Error('ECONNREFUSED'); } };
    const other = buildApp({ db: broken, store, validateKey: async () => ({}) });
    const res = await other.inject({ method: 'GET', url: '/api/planning', headers: KEY });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/^Base de données inaccessible/);
    expect(res.body).not.toContain('ECONNREFUSED');
    await other.close();
  });
});

describe('instantané', () => {
  it('renvoie l’instantané complet', async () => {
    const res = await call('GET', '/api/snapshot');
    expect(res.statusCode).toBe(200);
    expect(res.json().domain.issues).toHaveLength(4);
    expect(store.get).toHaveBeenCalledWith('good');
  });

  it('omet le domaine quand la version n’a pas changé', async () => {
    expect((await call('GET', '/api/snapshot?since=3')).json()).toEqual({
      version: 3, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null, domain: null,
    });
    expect((await call('GET', '/api/snapshot?since=2')).json().domain).not.toBeNull();
  });

  it('répond 503 si Linear est injoignable sans instantané', async () => {
    store.get.mockRejectedValueOnce(new LinearUnavailableError());
    const res = await call('GET', '/api/snapshot');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Linear injoignable' });
  });

  it('force un rafraîchissement complet', async () => {
    expect((await call('POST', '/api/refresh')).statusCode).toBe(200);
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
  });
});

describe('planification', () => {
  it('lit et modifie les réglages', async () => {
    expect((await call('GET', '/api/planning')).json().settings.hoursPerPoint).toBe(5);
    const res = await call('PUT', '/api/settings', { hoursPerPoint: 4, loadCeilingPct: 85, defaultWeeklyHours: 30 });
    expect(res.json().settings).toEqual({ hoursPerPoint: 4, loadCeilingPct: 85, defaultWeeklyHours: 30 });
  });

  it('refuse des réglages hors bornes', async () => {
    const res = await call('PUT', '/api/settings', { hoursPerPoint: 5, loadCeilingPct: 5, defaultWeeklyHours: 28 });
    expect(res.statusCode).toBe(400);
  });

  it('modifie une personne', async () => {
    const res = await call('PUT', '/api/people/u-louis', { role: 'hardware', defaultWeeklyHours: null });
    expect(res.json().people).toEqual([
      { linearUserId: 'u-louis', role: 'hardware', defaultWeeklyHours: null, active: true },
    ]);
  });

  it('pose puis retire une capacité exceptionnelle un lundi seulement', async () => {
    expect((await call('PUT', '/api/people/u-louis/capacity/2026-09-22', { hours: 10 })).statusCode).toBe(400);
    expect((await call('PUT', '/api/people/u-louis/capacity/2026-02-30', { hours: 10 })).statusCode).toBe(400);
    const set = await call('PUT', '/api/people/u-louis/capacity/2026-09-21', { hours: 0 });
    expect(set.json().weeklyCapacities).toEqual([{ linearUserId: 'u-louis', weekStart: '2026-09-21', hours: 0 }]);
    const del = await call('DELETE', '/api/people/u-louis/capacity/2026-09-21');
    expect(del.json().weeklyCapacities).toEqual([]);
  });

  it('remplace puis efface les parts d’une issue', async () => {
    const set = await call('PUT', '/api/issues/i-11/contributions', {
      shares: [{ linearUserId: 'u-sacha', share: 70 }, { linearUserId: 'u-louis', share: 30 }],
    });
    expect(set.json().contributions).toHaveLength(2);
    expect((await call('DELETE', '/api/issues/i-11/contributions')).json().contributions).toEqual([]);
  });

  it('refuse des parts invalides', async () => {
    expect((await call('PUT', '/api/issues/i-11/contributions', { shares: [] })).statusCode).toBe(400);
    expect((await call('PUT', '/api/issues/i-11/contributions', {
      shares: [{ linearUserId: 'u-sacha', share: -1 }],
    })).statusCode).toBe(400);
    expect((await call('PUT', '/api/issues/i-11/contributions', {
      shares: [{ linearUserId: 'u-sacha', share: 50 }, { linearUserId: 'u-sacha', share: 50 }],
    })).statusCode).toBe(400);
  });

  it('ajoute et retire un jour chômé', async () => {
    expect((await call('POST', '/api/holidays', { day: '2026-12-24', label: 'Pont' })).json().holidays)
      .toContainEqual({ day: '2026-12-24', label: 'Pont' });
    expect((await call('POST', '/api/holidays', { day: '2026-13-01', label: 'X' })).statusCode).toBe(400);
    expect((await call('POST', '/api/holidays', { day: '2026-12-24', label: '' })).statusCode).toBe(400);
    const del = await call('DELETE', '/api/holidays/2026-11-11');
    expect(del.json().holidays.map((h) => h.day)).not.toContain('2026-11-11');
  });
});
