import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createSnapshotStore } from '../../src/server/sync/snapshotStore.js';
import { fetchWorkspace, fetchIssuesSince } from '../../src/server/linear/queries.js';
import * as mutations from '../../src/server/linear/mutations.js';
import { createTestDb } from '../helpers/db.js';
import { fakeLinearApi } from '../helpers/fakeLinearApi.js';

const KEY = { 'x-linear-key': 'good' };
let app;
let api;
let db;

beforeEach(async () => {
  db = await createTestDb();
  api = fakeLinearApi();
  const opts = { fetchImpl: api.fetchImpl };
  const store = createSnapshotStore({
    fetchWorkspace: (key) => fetchWorkspace(key, opts),
    fetchIssuesSince: (key, since) => fetchIssuesSince(key, since, opts),
  });
  const wrap = (fn) => (key, ...args) => fn(key, ...args, opts);
  const linear = Object.fromEntries(Object.entries(mutations).filter(([, v]) => typeof v === 'function').map(([k, fn]) => [k, wrap(fn)]));
  app = buildApp({ db, store, validateKey: async () => ({ id: 'u' }), linear, refreshDelayMs: 0 });
  await app.ready();
  await app.inject({ method: 'GET', url: '/api/snapshot', headers: KEY });
});

afterEach(() => app.close());

const call = (method, url, payload) => app.inject({ method, url, payload, headers: KEY });
const milestoneDate = (res) => res.json().domain.projects[0].milestones.find((m) => m.id === 'm-1')?.date;

describe('jalons — tout le trajet, avec un Linear qui garde son état', () => {
  it('déplacer un jalon : Linear est modifié ET la réponse rend la nouvelle date', async () => {
    const res = await call('PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' });
    expect(res.statusCode, res.body).toBe(200);
    expect(api.raw.projects[0].projectMilestones.nodes[0].targetDate).toBe('2026-11-12');
    expect(milestoneDate(res)).toBe('2026-11-12');
  });

  it('la date déplacée reste après un nouveau chargement de l\'instantané', async () => {
    await call('PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' });
    const again = await call('GET', '/api/snapshot');
    expect(milestoneDate(again)).toBe('2026-11-12');
  });

  it('créer un jalon : il existe dans Linear ET apparaît dans la réponse et à la relecture', async () => {
    const res = await call('POST', '/api/milestones', { projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(res.statusCode, res.body).toBe(200);
    const { milestoneId, domain } = res.json();
    expect(api.raw.projects[0].projectMilestones.nodes.map((m) => m.name)).toContain('Livraison');
    expect(domain.projects[0].milestones).toContainEqual({ id: milestoneId, name: 'Livraison', date: '2026-12-01' });
    const again = await call('GET', '/api/snapshot');
    expect(again.json().domain.projects[0].milestones.map((m) => m.id)).toContain(milestoneId);
  });

  it('un jalon sans date est créé, sans date', async () => {
    const res = await call('POST', '/api/milestones', { projectId: 'p-poc1', name: 'À dater' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().domain.projects[0].milestones.find((m) => m.name === 'À dater').date).toBeNull();
  });

  it('un refus de Linear rend son message, pas « Erreur interne »', async () => {
    const res = await call('PUT', '/api/milestones/inconnu', { targetDate: '2026-11-12' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Entity not found/);
  });
});
