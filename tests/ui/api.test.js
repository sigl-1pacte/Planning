import { describe, it, expect } from 'vitest';
import { createApi, AuthError, ApiError } from '../../src/ui/api.js';
import { fakeFetch, jsonResponse } from '../helpers/fakeFetch.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('api', () => {
  it('valide puis mémorise la clé, et l’envoie ensuite à chaque appel', async () => {
    const storage = memoryStorage();
    const f = fakeFetch([jsonResponse({ user: { id: 'u1' } }), jsonResponse({ settings: {} })]);
    const api = createApi({ fetchImpl: f, storage });
    expect(await api.saveKey('lin_api_1')).toEqual({ id: 'u1' });
    expect(api.getKey()).toBe('lin_api_1');
    await api.planning();
    expect(f.calls[1].url).toBe('/api/planning');
    expect(f.calls[1].headers['x-linear-key']).toBe('lin_api_1');
  });

  it('ne mémorise pas une clé refusée', async () => {
    const storage = memoryStorage();
    const api = createApi({ fetchImpl: fakeFetch([jsonResponse({ error: 'Clé Linear invalide ou révoquée' }, 401)]), storage });
    await expect(api.saveKey('bad')).rejects.toBeInstanceOf(AuthError);
    expect(api.getKey()).toBeNull();
  });

  it('oublie la clé', () => {
    const storage = memoryStorage();
    storage.setItem('planning.linearKey', 'k');
    const api = createApi({ fetchImpl: fakeFetch([]), storage });
    api.forgetKey();
    expect(api.getKey()).toBeNull();
  });

  it('envoie les corps en JSON et construit les chemins', async () => {
    const f = fakeFetch([jsonResponse({}), jsonResponse({}), jsonResponse({ version: 2 })]);
    const api = createApi({ fetchImpl: f, storage: memoryStorage() });
    await api.setCapacity('u/1', '2026-09-21', 0);
    await api.setContributions('i1', [{ linearUserId: 'u1', share: 100 }]);
    await api.snapshot(3);
    expect(f.calls[0].url).toBe('/api/people/u%2F1/capacity/2026-09-21');
    expect(f.calls[0].body).toEqual({ hours: 0 });
    expect(f.calls[1].body).toEqual({ shares: [{ linearUserId: 'u1', share: 100 }] });
    expect(f.calls[2].url).toBe('/api/snapshot?since=3');
  });

  it('remonte le message d’erreur du serveur', async () => {
    const api = createApi({ fetchImpl: fakeFetch([jsonResponse({ error: 'Linear injoignable' }, 503)]), storage: memoryStorage() });
    const err = await api.refresh().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Linear injoignable');
    expect(err.status).toBe(503);
  });

  it('survit à un stockage local inaccessible', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    const api = createApi({ fetchImpl: fakeFetch([]), storage: broken });
    expect(api.getKey()).toBeNull();
    expect(() => api.forgetKey()).not.toThrow();
  });

  it('n\'envoie jamais une écriture Linear au backend : elles partent directement vers Linear, avec la clé de l\'utilisateur', async () => {
    const backend = fakeFetch([jsonResponse({ domain: {} })]);
    const linearCalls = [];
    const linearFetch = async (url, init) => {
      const { query } = JSON.parse(init.body);
      linearCalls.push({ url, auth: init.headers.Authorization, op: /mutation\s+(\w+)/.exec(query)?.[1] });
      return { status: 200, json: async () => ({ data: { milestone: { success: true }, projectMilestoneUpdate: { success: true, projectMilestone: {} } } }) };
    };
    const storage = memoryStorage();
    storage.setItem('planning.linearKey', 'lin_perso');
    const api = createApi({ fetchImpl: backend, storage, getDomain: () => null, linearOpts: { fetchImpl: linearFetch } });
    await api.updateMilestone('m1', '2026-11-05');
    expect(linearCalls).toEqual([{ url: 'https://api.linear.app/graphql', auth: 'lin_perso', op: 'ProjectMilestoneUpdate' }]);
    // Côté backend : uniquement la relecture (POST /api/refresh), jamais la modification.
    expect(backend.calls.map((c) => [c.method, c.url])).toEqual([['POST', '/api/refresh']]);
  });
});
