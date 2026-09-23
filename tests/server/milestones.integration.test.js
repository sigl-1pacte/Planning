import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createSnapshotStore } from '../../src/server/sync/snapshotStore.js';
import { fetchWorkspace, fetchIssuesSince } from '../../src/server/linear/queries.js';
import { createApi } from '../../src/ui/api.js';
import { createTestDb } from '../helpers/db.js';
import { fakeLinearApi } from '../helpers/fakeLinearApi.js';

// Trajet complet : les écritures partent du client (avec sa clé, vers un faux
// Linear qui garde son état) ; le backend ne sert qu'à relire Linear.
const KEY = { 'x-linear-key': 'good' };
let app;
let linearApi;
let db;
let client;
let domain = null;

beforeEach(async () => {
  db = await createTestDb();
  linearApi = fakeLinearApi();
  const opts = { fetchImpl: linearApi.fetchImpl };
  const store = createSnapshotStore({
    fetchWorkspace: (key) => fetchWorkspace(key, opts),
    fetchIssuesSince: (key, since) => fetchIssuesSince(key, since, opts),
  });
  app = buildApp({ db, store, validateKey: async () => ({ id: 'u' }) });
  await app.ready();
  domain = (await app.inject({ method: 'GET', url: '/api/snapshot', headers: KEY })).json().domain;
  // Le « réseau » du client : ne joint que le backend (lecture / resynchronisation).
  const fetchImpl = async (url, init) => {
    const res = await app.inject({ method: init.method, url, payload: init.body, headers: init.body ? { ...KEY, 'content-type': 'application/json' } : KEY });
    return { status: res.statusCode, json: async () => res.json() };
  };
  client = createApi({
    fetchImpl, getDomain: () => domain, linearOpts: opts,
    storage: { getItem: () => 'good', setItem() {}, removeItem() {} },
  });
});

afterEach(() => app.close());

const milestoneDate = (res) => res.domain.projects[0].milestones.find((m) => m.id === 'm-1')?.date;

describe('jalons — tout le trajet, écritures depuis le client, avec un Linear qui garde son état', () => {
  it('déplacer un jalon : Linear est modifié ET la réponse rend la nouvelle date', async () => {
    const res = await client.updateMilestone('m-1', '2026-11-12');
    expect(linearApi.raw.projects[0].projectMilestones.nodes[0].targetDate).toBe('2026-11-12');
    expect(milestoneDate(res)).toBe('2026-11-12');
  });

  it('la date déplacée reste après un nouveau chargement de l\'instantané', async () => {
    await client.updateMilestone('m-1', '2026-11-12');
    const again = await client.snapshot();
    expect(milestoneDate(again)).toBe('2026-11-12');
  });

  it('créer un jalon : il existe dans Linear ET apparaît dans la réponse et à la relecture', async () => {
    const { milestoneId, domain: after } = await client.createMilestone({ projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(linearApi.raw.projects[0].projectMilestones.nodes.map((m) => m.name)).toContain('Livraison');
    expect(after.projects[0].milestones).toContainEqual({ id: milestoneId, name: 'Livraison', date: '2026-12-01' });
    const again = await client.snapshot();
    expect(again.domain.projects[0].milestones.map((m) => m.id)).toContain(milestoneId);
  });

  it('un jalon sans date est créé, sans date', async () => {
    const res = await client.createMilestone({ projectId: 'p-poc1', name: 'À dater' });
    expect(res.domain.projects[0].milestones.find((m) => m.name === 'À dater').date).toBeNull();
  });

  it('un refus de Linear rend son message, pas « Erreur interne »', async () => {
    await expect(client.updateMilestone('inconnu', '2026-11-12')).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Entity not found/) });
  });
});

describe('le backend n\'écrit jamais vers Linear', () => {
  it('refuse toute route d\'écriture vers Linear (introuvable), sans appeler Linear', async () => {
    const before = linearApi.log.length;
    const routes = [
      ['PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' }],
      ['POST', '/api/milestones', { projectId: 'p-poc1', name: 'X' }],
      ['PUT', '/api/issues/i-11', { title: 'X' }],
      ['POST', '/api/issues/i-11/reschedule', { start: '2026-09-20' }],
      ['PUT', '/api/issues/i-11/dependencies', { blockedBy: [] }],
      ['PUT', '/api/issues/i-11/contributors', { contributorIds: [] }],
      ['POST', '/api/issues', { teamId: 't-iot', title: 'X' }],
      ['DELETE', '/api/issues/i-11', { confirm: 'IOT-11' }],
      ['PUT', '/api/projects/p-poc1', { name: 'X' }],
      ['POST', '/api/projects', { teamIds: ['t-iot'], name: 'X' }],
      ['DELETE', '/api/projects/p-poc1', { confirm: 'X' }],
      ['POST', '/api/teams', { key: 'NEW', name: 'Nouvelle' }],
    ];
    for (const [method, url, payload] of routes) {
      const res = await app.inject({ method, url, payload, headers: KEY });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(linearApi.log.length).toBe(before);
  });
});
