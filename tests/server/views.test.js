import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createTestDb } from '../helpers/db.js';
import { MAX_VIEWS } from '../../src/server/db/views.js';
import { LinearAuthError } from '../../src/server/linear/client.js';

// Deux clés, deux personnes : chacune ne voit et ne modifie que ses vues.
const USERS = { good: { id: 'u-sacha', name: 'Sacha' }, other: { id: 'u-louis', name: 'Louis' } };
const AS = (key) => ({ 'x-linear-key': key });
const F = (over = {}) => ({ people: [], projects: [], due: null, q: '', ...over });

let app;

beforeEach(async () => {
  const db = await createTestDb();
  const store = { get: vi.fn(), forceRefresh: vi.fn(), current: vi.fn() };
  const validateKey = async (key) => {
    if (!USERS[key]) throw new LinearAuthError();
    return USERS[key];
  };
  app = buildApp({ db, store, validateKey });
  await app.ready();
});

afterEach(() => app.close());

const call = (method, url, payload, key = 'good') => app.inject({ method, url, payload, headers: AS(key) });

describe('vues enregistrées', () => {
  it('rend les vues de la personne connectée et son id Linear (le « moi » des filtres)', async () => {
    expect((await call('GET', '/api/views')).json()).toEqual({ me: 'u-sacha', views: [] });
    expect((await call('GET', '/api/views', undefined, 'other')).json()).toEqual({ me: 'u-louis', views: [] });
  });

  it('crée une vue : nom nettoyé, filtre normalisé, id rendu', async () => {
    const res = await call('POST', '/api/views', { name: '  Mes urgences ', filter: F({ people: ['me', 'me', 'u-ines'], due: 'overdue' }) });
    expect(res.statusCode).toBe(200);
    const { id, views } = res.json();
    expect(views).toEqual([{ id, name: 'Mes urgences', filter: F({ people: ['me', 'u-ines'], due: 'overdue' }) }]);
  });

  it('les vues des autres restent invisibles et intouchables', async () => {
    const { id } = (await call('POST', '/api/views', { name: 'À moi', filter: F({ q: 'capteur' }) })).json();
    expect((await call('GET', '/api/views', undefined, 'other')).json().views).toEqual([]);
    expect((await call('PUT', `/api/views/${id}`, { name: 'Volée' }, 'other')).statusCode).toBe(404);
    expect((await call('DELETE', `/api/views/${id}`, undefined, 'other')).statusCode).toBe(404);
    expect((await call('GET', '/api/views')).json().views.map((v) => v.name)).toEqual(['À moi']);
  });

  it('renomme, change le filtre, supprime', async () => {
    const { id } = (await call('POST', '/api/views', { name: 'A', filter: F() })).json();
    expect((await call('PUT', `/api/views/${id}`, { name: 'B' })).json().views[0]).toEqual({ id, name: 'B', filter: F() });
    expect((await call('PUT', `/api/views/${id}`, { filter: F({ projects: ['none'] }) })).json().views[0].filter).toEqual(F({ projects: ['none'] }));
    expect((await call('DELETE', `/api/views/${id}`)).json()).toEqual({ me: 'u-sacha', views: [] });
    expect((await call('DELETE', `/api/views/${id}`)).statusCode).toBe(404);
  });

  it('refuse un doublon de nom (sans tenir compte de la casse), pas chez un autre', async () => {
    await call('POST', '/api/views', { name: 'Sprint', filter: F() });
    const dup = await call('POST', '/api/views', { name: 'SPRINT', filter: F() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('Vous avez déjà une vue « SPRINT »');
    expect((await call('POST', '/api/views', { name: 'Sprint', filter: F() }, 'other')).statusCode).toBe(200);
  });

  it('refuse un corps invalide, un id inconnu, et une vue de trop', async () => {
    for (const body of [
      { name: 'X' }, { name: '   ', filter: F() }, { name: 'X', filter: F({ due: 'demain' }) },
      { name: 'X', filter: { people: [] } }, { name: 'x'.repeat(61), filter: F() },
    ]) {
      expect((await call('POST', '/api/views', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await call('PUT', '/api/views/abc', { name: 'Y' })).statusCode).toBe(404);
    expect((await call('PUT', '/api/views/1', {})).statusCode).toBe(400);
    for (let k = 0; k < MAX_VIEWS; k += 1) await call('POST', '/api/views', { name: `V${k}`, filter: F() });
    expect((await call('POST', '/api/views', { name: 'Encore', filter: F() })).statusCode).toBe(400);
  });

  it('exige une clé Linear', async () => {
    expect((await call('GET', '/api/views', undefined, 'mauvaise')).statusCode).toBe(401);
  });
});
