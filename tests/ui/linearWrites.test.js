import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinearWrites } from '../../src/ui/linearWrites.js';
import { AuthError, ApiError } from '../../src/ui/api.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

// Les écritures vers Linear partent du navigateur (clé de l'utilisateur), pas
// du backend : ces tests couvrent ce qui vivait dans les routes d'écriture du
// serveur. `call` garde la forme « méthode + chemin » de ces anciens tests et
// l'aiguille vers les fonctions du client, pour comparer les comportements.
const snap = {
  version: 3, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null,
  domain: mapWorkspace(rawWorkspace()),
};

let linear;
let resync;
let domainNow;
let writes;

beforeEach(() => {
  domainNow = snap.domain;
  resync = vi.fn(async () => snap);
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
    createMilestone: vi.fn(async () => ({ id: 'm-new' })),
    addComment: vi.fn(async () => {}),
    subscribeToIssue: vi.fn(async () => {}),
  };
  writes = createLinearWrites({
    getKey: () => 'good', getDomain: () => domainNow, resync, AuthError, ApiError, delayMs: 0, linear,
  });
});

const segs = (url) => url.split('/').filter(Boolean).slice(1);

async function call(method, url, payload = {}) {
  const [kind, id, sub] = segs(url);
  try {
    let out;
    if (kind === 'issues' && method === 'PUT' && !sub) out = await writes.updateIssue(id, payload);
    else if (kind === 'issues' && sub === 'reschedule') out = await writes.reschedule(id, payload);
    else if (kind === 'issues' && sub === 'dependencies') out = await writes.setDependencies(id, payload.blockedBy);
    else if (kind === 'issues' && sub === 'contributors') out = await writes.setContributors(id, payload.contributorIds);
    else if (kind === 'issues' && method === 'POST') out = await writes.createIssue(payload);
    else if (kind === 'issues' && method === 'DELETE') out = await writes.deleteIssue(id, payload?.confirm);
    else if (kind === 'projects' && method === 'PUT') out = await writes.updateProject(id, payload);
    else if (kind === 'projects' && method === 'POST') out = await writes.createProject(payload);
    else if (kind === 'projects' && method === 'DELETE') out = await writes.deleteProject(id, payload?.confirm);
    else if (kind === 'teams') out = await writes.createTeam(payload);
    else if (kind === 'milestones' && method === 'POST') out = await writes.createMilestone(payload);
    else if (kind === 'milestones' && method === 'PUT') out = await writes.updateMilestone(id, payload.targetDate);
    else throw new Error(`route de test inconnue : ${method} ${url}`);
    return { statusCode: 200, json: () => out };
  } catch (err) {
    if (err instanceof AuthError) return { statusCode: 401, json: () => ({ error: err.message }) };
    if (err instanceof ApiError) return { statusCode: err.status, json: () => ({ error: err.message }) };
    throw err;
  }
}

describe('écritures Linear depuis le client', () => {
  it('modifie une issue puis force un rafraîchissement', async () => {
    const res = await call('PUT', '/api/issues/i-11', { title: 'Nouveau titre' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', { title: 'Nouveau titre' });
    expect(resync).toHaveBeenCalled();
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
    domainNow = cyclic.domain;
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

  it('déplace une tâche vers une autre team : statut et projet réalignés, rien d\'autre modifié', async () => {
    const res = await call('PUT', '/api/issues/i-11', { teamId: 't-web' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateIssue).toHaveBeenCalledWith('good', 'i-11', { teamId: 't-web', stateId: 'st-web-unstarted', projectId: null });
  });

  it('refuse un déplacement invalide sans appeler Linear', async () => {
    for (const body of [{ teamId: 'inconnue' }, { teamId: 't-web', stateId: 'st-iot-started' }, { projectId: 'inconnu' }]) {
      expect((await call('PUT', '/api/issues/i-11', body)).statusCode).toBe(400);
    }
    expect((await call('PUT', '/api/issues/inconnue', { teamId: 't-web' })).statusCode).toBe(404);
    expect(linear.updateIssue).not.toHaveBeenCalled();
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
    expect(resync).toHaveBeenCalled();
    resync.mockClear();
    await call('POST', '/api/teams', { key: 'NEW', name: 'Nouvelle team' });
    expect(resync).toHaveBeenCalled();
    resync.mockClear();
    await call('POST', '/api/issues', { teamId: 't-iot', title: 'T' });
    expect(resync).toHaveBeenCalled();
    resync.mockClear();
    await call('PUT', '/api/projects/p-poc1', { name: 'Renommé' });
    expect(resync).toHaveBeenCalled();
    resync.mockClear();
    await call('PUT', '/api/milestones/m-1', { targetDate: '2026-11-12' });
    expect(resync).toHaveBeenCalled();
  });

  it('modifie les dates et la couleur d\'un projet', async () => {
    const res = await call('PUT', '/api/projects/p-poc1', { startDate: '2026-09-20', targetDate: '2026-11-20', color: '#ff0000' });
    expect(res.statusCode).toBe(200);
    expect(linear.updateProject).toHaveBeenCalledWith('good', 'p-poc1', { startDate: '2026-09-20', targetDate: '2026-11-20', color: '#ff0000' });
  });

  it('crée un jalon dans un projet et relit Linear en entier', async () => {
    const res = await call('POST', '/api/milestones', { projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().milestoneId).toBe('m-new');
    expect(linear.createMilestone).toHaveBeenCalledWith('good', { projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(resync).toHaveBeenCalled();
  });

  it('refuse un jalon invalide sans appeler Linear', async () => {
    for (const [body, status] of [
      [{ projectId: 'p-poc1', name: '  ' }, 400], [{ projectId: 'p-poc1', name: 'X', targetDate: '2026-02-30' }, 400],
      [{ projectId: 'inconnu', name: 'X' }, 404],
    ]) {
      expect((await call('POST', '/api/milestones', body)).statusCode, JSON.stringify(body)).toBe(status);
    }
    expect(linear.createMilestone).not.toHaveBeenCalled();
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
      expect(resync).toHaveBeenCalled();
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

    it('rend le message de Linear quand il refuse la suppression, pas « Erreur interne »', async () => {
      linear.deleteProject.mockRejectedValueOnce(Object.assign(new Error('Erreur GraphQL Linear : Forbidden'), { statusCode: 422 }));
      const res = await call('DELETE', '/api/projects/p-poc1', { confirm: project.name });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/Forbidden/);
    });

  });
});
