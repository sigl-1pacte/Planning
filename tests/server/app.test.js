import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createTestDb } from '../helpers/db.js';
import { setContributions, getPlanning } from '../../src/server/db/repo.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';
import { LinearAuthError, LinearUnavailableError } from '../../src/server/linear/client.js';
import { RescheduleCycleError } from '../../src/shared/reschedule.js';

const KEY = { 'x-linear-key': 'good' };
const snap = {
  version: 3, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null,
  domain: mapWorkspace(rawWorkspace()),
};

let app;
let db;
let store;
let linear;

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
  linear = {
    updateIssue: vi.fn(async () => ({})),
    createIssue: vi.fn(async () => ({ id: 'i-new', identifier: 'IOT-99' })),
    issueBlockers: vi.fn(async () => [{ relationId: 'r1', blockerId: 'i-11' }]),
    addBlocker: vi.fn(async () => {}),
    removeBlocker: vi.fn(async () => {}),
    updateProject: vi.fn(async () => ({})),
    createProject: vi.fn(async () => ({ id: 'p-new' })),
    createTeam: vi.fn(async () => ({})),
    deleteIssue: vi.fn(async () => {}),
    deleteProject: vi.fn(async () => {}),
    updateMilestone: vi.fn(async () => ({})),
    addComment: vi.fn(async () => {}),
    subscribeToIssue: vi.fn(async () => {}),
  };
  app = buildApp({ db, store, validateKey, linear, refreshDelayMs: 0 });
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

describe('écriture', () => {
  it('modifie une issue puis force un rafraîchissement', async () => {
    const res = await call('PUT', '/api/issues/i-11', { title: 'Nouveau titre' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', { title: 'Nouveau titre' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good');
    expect(res.json().domain.issues).toHaveLength(4);
  });

  it('modifie le début (sans cascade) via la description, et l\'échéance via dueDate natif', async () => {
    const res = await call('PUT', '/api/issues/i-11', { start: '2026-09-18', end: '2026-09-27' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', {
      description: 'Starting date: 18/09/2026\nContributors: @sacha @louis',
      dueDate: '2026-09-27',
    });
  });

  it('modifie le statut d\'une issue', async () => {
    const res = await call('PUT', '/api/issues/i-11', { stateId: 'st-iot-completed' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', { stateId: 'st-iot-completed' });
  });

  it('refuse un corps sans aucun champ', async () => {
    expect((await call('PUT', '/api/issues/i-11', {})).statusCode).toBe(400);
  });

  it('décale une issue et ses dépendantes', async () => {
    const res = await call('POST', '/api/issues/i-11/reschedule', { start: '2026-09-18', end: '2026-09-27' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changes.find((c) => c.issueId === 'i-11')).toMatchObject({ newStart: '2026-09-18' });
    expect(linear.updateIssue).toHaveBeenCalled();
    const call1 = linear.updateIssue.mock.calls.find((c) => c[1] === 'i-11');
    expect(call1[2].dueDate).toBe('2026-09-27');
    // La cascade ne doit remplacer que la ligne « Starting date » : le reste
    // de la description (dont la ligne Contributors) doit survivre intact.
    expect(call1[2].description).toBe('Starting date: 18/09/2026\nContributors: @sacha @louis');
  });

  it('refuse un décalage en cycle avec un message explicite', async () => {
    linear.updateIssue.mockClear();
    const cyclic = { ...snap, domain: { ...snap.domain, issues: [
      { id: 'a', identifier: 'A', teamId: 't-iot', status: 'todo', start: '2026-09-14', end: '2026-09-15', blockedBy: ['b'], contributorIds: [], estimate: 1 },
      { id: 'b', identifier: 'B', teamId: 't-iot', status: 'todo', start: '2026-09-16', end: '2026-09-17', blockedBy: ['a'], contributorIds: [], estimate: 1 },
    ] } };
    store.current.mockReturnValueOnce(cyclic);
    const res = await call('POST', '/api/issues/a/reschedule', { start: '2026-09-20', end: '2026-09-21' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/circulaires/);
    expect(linear.updateIssue).not.toHaveBeenCalled();
  });

  it('remplace la liste des bloqueurs par la différence exacte', async () => {
    const res = await call('PUT', '/api/issues/i-12/dependencies', { blockedBy: ['i-20'] });
    expect(res.statusCode).toBe(200);
    expect(linear.removeBlocker).toHaveBeenCalledWith('good', 'r1');
    expect(linear.addBlocker).toHaveBeenCalledWith('good', 'i-12', 'i-20');
  });

  it('crée une issue', async () => {
    const res = await call('POST', '/api/issues', { teamId: 't-iot', title: 'Nouvelle' });
    expect(res.statusCode).toBe(200);
    expect(res.json().issueId).toBe('i-new');
    expect(linear.createIssue).toHaveBeenCalledWith('good', { teamId: 't-iot', title: 'Nouvelle' });
  });

  it('crée une issue planifiée : Starting date dans la description, échéance en dueDate', async () => {
    const res = await call('POST', '/api/issues', { teamId: 't-iot', title: 'Nouvelle', start: '2026-09-28', end: '2026-10-02' });
    expect(res.statusCode).toBe(200);
    expect(linear.createIssue).toHaveBeenCalledWith('good', {
      teamId: 't-iot', title: 'Nouvelle', description: 'Starting date: 28/09/2026', dueDate: '2026-10-02',
    });
  });

  it('refuse une création avec une seule date, une date invalide ou une échéance avant le début', async () => {
    for (const dates of [
      { start: '2026-09-28' },
      { end: '2026-10-02' },
      { start: '2026-02-30', end: '2026-03-02' },
      { start: '2026-10-02', end: '2026-09-28' },
    ]) {
      expect((await call('POST', '/api/issues', { teamId: 't-iot', title: 'X', ...dates })).statusCode).toBe(400);
    }
    expect(linear.createIssue).not.toHaveBeenCalled();
  });

  it('crée une tâche complète : champs Linear, dépendances, contributeurs, avertissements vides', async () => {
    const res = await call('POST', '/api/issues', {
      teamId: 't-iot', title: 'Complète', projectId: 'p-poc1', stateId: 'st-iot-started', assigneeId: 'u-louis',
      estimate: 5, start: '2026-09-28', end: '2026-10-02', blockedBy: ['i-11'], contributorIds: ['u-sacha'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([]);
    expect(linear.createIssue).toHaveBeenCalledWith('good', {
      teamId: 't-iot', title: 'Complète', projectId: 'p-poc1', stateId: 'st-iot-started', assigneeId: 'u-louis', estimate: 5,
      description: 'Starting date: 28/09/2026\n\nContributors: @sacha', dueDate: '2026-10-02',
    });
    expect(linear.addBlocker).toHaveBeenCalledWith('good', 'i-new', 'i-11');
    expect(linear.subscribeToIssue).toHaveBeenCalledWith('good', 'i-new', 'u-sacha');
  });

  it('refuse une tâche avec un statut d\'une autre team, sans rien créer', async () => {
    const res = await call('POST', '/api/issues', { teamId: 't-iot', title: 'X', stateId: 'st-web-unstarted' });
    expect(res.statusCode).toBe(400);
    expect(linear.createIssue).not.toHaveBeenCalled();
  });

  it('crée un projet avec dates et couleur, et refuse une échéance avant le début', async () => {
    const ok = await call('POST', '/api/projects', { teamIds: ['t-iot'], name: 'P', startDate: '2026-10-01', targetDate: '2026-12-01', color: '#112233' });
    expect(ok.statusCode).toBe(200);
    expect(linear.createProject).toHaveBeenCalledWith('good', { teamIds: ['t-iot'], name: 'P', startDate: '2026-10-01', targetDate: '2026-12-01', color: '#112233' });
    linear.createProject.mockClear();
    const bad = await call('POST', '/api/projects', { teamIds: ['t-iot'], name: 'P', startDate: '2026-12-01', targetDate: '2026-10-01' });
    expect(bad.statusCode).toBe(400);
    expect(linear.createProject).not.toHaveBeenCalled();
  });

  it('refuse une création sans team ni titre', async () => {
    expect((await call('POST', '/api/issues', { teamId: 't-iot' })).statusCode).toBe(400);
  });

  it('remplace les contributeurs, commente et abonne uniquement les nouveaux', async () => {
    // i-12 n'a pas de ligne Contributors (contributeur par défaut : l'assigné, u-louis).
    const res = await call('PUT', '/api/issues/i-12/contributors', { contributorIds: ['u-louis', 'u-sacha'] });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-12', {
      description: 'Starting date: 28/09/2026\n\nContributors: @louis @sacha',
    });
    expect(linear.addComment).toHaveBeenCalledWith('good', 'i-12', 'Ajouté·e·s comme contributeurs : Sacha');
    expect(linear.subscribeToIssue).toHaveBeenCalledWith('good', 'i-12', 'u-sacha');
    expect(linear.subscribeToIssue).not.toHaveBeenCalledWith('good', 'i-12', 'u-louis');
  });

  it('ne commente ni n\'abonne quand personne de nouveau n\'est ajouté', async () => {
    // i-11 porte déjà @sacha et @louis ; on retire louis, personne n'est nouveau.
    const res = await call('PUT', '/api/issues/i-11/contributors', { contributorIds: ['u-sacha'] });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', {
      description: 'Starting date: 16/09/2026\nContributors: @sacha',
    });
    expect(linear.addComment).not.toHaveBeenCalled();
    expect(linear.subscribeToIssue).not.toHaveBeenCalled();
  });

  it('purge en base la part de qui n\'est plus contributeur', async () => {
    await setContributions(db, 'i-11', [{ linearUserId: 'u-sacha', share: 60 }, { linearUserId: 'u-louis', share: 40 }]);
    const res = await call('PUT', '/api/issues/i-11/contributors', { contributorIds: ['u-sacha'] });
    expect(res.statusCode).toBe(200);
    expect((await getPlanning(db)).contributions).toEqual([{ issueId: 'i-11', linearUserId: 'u-sacha', share: 60 }]);
  });

  it('refuse une issue inconnue pour les contributeurs', async () => {
    const res = await call('PUT', '/api/issues/inconnue/contributors', { contributorIds: [] });
    expect(res.statusCode).toBe(404);
  });

  it('modifie et crée un projet, crée une team', async () => {
    expect((await call('PUT', '/api/projects/p-poc1', { name: 'Nouveau nom' })).statusCode).toBe(200);
    const created = await call('POST', '/api/projects', { teamIds: ['t-iot'], name: 'X' });
    expect(created.json().projectId).toBe('p-new');
    expect((await call('POST', '/api/teams', { key: 'NEW', name: 'Nouvelle team' })).statusCode).toBe(200);
  });

  it('relit Linear en synchronisation complète après avoir créé ou modifié un projet, une team, une tâche', async () => {
    await call('POST', '/api/projects', { teamIds: ['t-iot'], name: 'X' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
    store.forceRefresh.mockClear();
    await call('POST', '/api/teams', { key: 'NEW', name: 'Nouvelle team' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
    store.forceRefresh.mockClear();
    await call('POST', '/api/issues', { teamId: 't-iot', title: 'T' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
    store.forceRefresh.mockClear();
    await call('PUT', '/api/projects/p-poc1', { name: 'Renommé' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
    store.forceRefresh.mockClear();
    await call('PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' });
    expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
  });

  it('modifie les dates et la couleur d\'un projet', async () => {
    const res = await call('PUT', '/api/projects/p-poc1', { startDate: '2026-09-20', targetDate: '2026-11-20', color: '#ff0000' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateProject).toHaveBeenCalledWith('good', 'p-poc1', { startDate: '2026-09-20', targetDate: '2026-11-20', color: '#ff0000' });
  });

  it('modifie la date d\'un jalon', async () => {
    const res = await call('PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateMilestone).toHaveBeenCalledWith('good', 'm-1', { targetDate: '2026-11-12' });
  });

  describe('suppression', () => {
    const issue = snap.domain.issues.find((i) => i.id === 'i-11');
    const project = snap.domain.projects.find((p) => p.id === 'p-poc1');

    it('supprime une tâche quand son identifiant exact est confirmé, puis relit Linear en entier', async () => {
      const res = await call('DELETE', '/api/issues/i-11', { confirm: issue.identifier });
      expect(res.statusCode).toBe(200);
      expect(linear.deleteIssue).toHaveBeenCalledWith('good', 'i-11');
      expect(store.forceRefresh).toHaveBeenCalledWith('good', { full: true });
    });

    it('supprime un projet quand son nom exact est confirmé', async () => {
      const res = await call('DELETE', '/api/projects/p-poc1', { confirm: project.name });
      expect(res.statusCode).toBe(200);
      expect(linear.deleteProject).toHaveBeenCalledWith('good', 'p-poc1');
    });

    it('refuse sans confirmation, avec une confirmation fausse ou approximative — rien n\'est supprimé', async () => {
      const wrong = [undefined, {}, { confirm: '' }, { confirm: 'IOT-12' }, { confirm: issue.identifier.toLowerCase() }, { confirm: ` ${issue.identifier}` }];
      for (const body of wrong) {
        expect((await call('DELETE', '/api/issues/i-11', body)).statusCode).toBe(400);
      }
      for (const body of [undefined, {}, { confirm: 'autre' }, { confirm: project.name.toUpperCase() }]) {
        expect((await call('DELETE', '/api/projects/p-poc1', body)).statusCode).toBe(400);
      }
      expect(linear.deleteIssue).not.toHaveBeenCalled();
      expect(linear.deleteProject).not.toHaveBeenCalled();
    });

    it('répond 404 pour une tâche ou un projet inconnus, et ne confond pas l\'identifiant d\'une autre tâche', async () => {
      expect((await call('DELETE', '/api/issues/inconnue', { confirm: issue.identifier })).statusCode).toBe(404);
      expect((await call('DELETE', '/api/projects/inconnu', { confirm: project.name })).statusCode).toBe(404);
      const other = snap.domain.issues.find((i) => i.id !== 'i-11');
      expect((await call('DELETE', '/api/issues/i-11', { confirm: other.identifier })).statusCode).toBe(400);
      expect(linear.deleteIssue).not.toHaveBeenCalled();
    });

    it('exige la clé Linear', async () => {
      expect((await call('DELETE', '/api/issues/i-11', { confirm: issue.identifier }, {})).statusCode).toBe(401);
      expect(linear.deleteIssue).not.toHaveBeenCalled();
    });
  });
});
