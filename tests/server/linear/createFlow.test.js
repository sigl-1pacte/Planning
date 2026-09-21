import { describe, it, expect, vi } from 'vitest';
import { buildIssuePlan, buildProjectInput, createIssueWithExtras, withMove, buildMilestoneInput } from '../../../src/server/linear/createFlow.js';
import { mapWorkspace } from '../../../src/server/linear/mapper.js';
import { rawWorkspace } from '../../fixtures/workspace.js';

const domain = mapWorkspace(rawWorkspace());
const base = { teamId: 't-iot', title: 'T' };

function fakeLinear(over = {}) {
  return {
    createIssue: vi.fn(async () => ({ id: 'i-new' })),
    addBlocker: vi.fn(async () => {}),
    addComment: vi.fn(async () => {}),
    subscribeToIssue: vi.fn(async () => {}),
    ...over,
  };
}

describe('buildIssuePlan', () => {
  it('passe titre, team, projet, statut, responsable et estimation tels quels', () => {
    const { input } = buildIssuePlan({
      ...base, projectId: 'p-poc1', stateId: 'st-iot-started', assigneeId: 'u-louis', estimate: 3,
    }, domain);
    expect(input).toEqual({ ...base, projectId: 'p-poc1', stateId: 'st-iot-started', assigneeId: 'u-louis', estimate: 3 });
  });

  it('écrit la Starting date et les contributeurs dans la description, l\'échéance en dueDate', () => {
    const { input, contributors } = buildIssuePlan({
      ...base, start: '2026-09-28', end: '2026-10-02', contributorIds: ['u-sacha', 'u-louis'],
    }, domain);
    expect(input.description).toBe('Starting date: 28/09/2026\n\nContributors: @sacha @louis');
    expect(input.dueDate).toBe('2026-10-02');
    expect(contributors.map((u) => u.id)).toEqual(['u-sacha', 'u-louis']);
  });

  it('ne met pas de description quand rien n\'en demande une', () => {
    expect(buildIssuePlan(base, domain).input).toEqual(base);
  });

  it('refuse, avant tout appel à Linear, ce qui est invalide', () => {
    const cases = [
      [{ start: '2026-09-28' }, 400], [{ end: '2026-09-28' }, 400],
      [{ start: '2026-02-30', end: '2026-03-01' }, 400], [{ start: '2026-10-02', end: '2026-09-28' }, 400],
      [{ stateId: 'st-web-unstarted' }, 400], [{ stateId: 'inconnu' }, 400],
      [{ assigneeId: 'inconnu' }, 400], [{ blockedBy: ['inconnue'] }, 400], [{ contributorIds: ['inconnu'] }, 400],
    ];
    for (const [extra, status] of cases) {
      expect(() => buildIssuePlan({ ...base, ...extra }, domain), JSON.stringify(extra)).toThrow(expect.objectContaining({ statusCode: status }));
    }
  });

  it('répond 503 s\'il faut l\'instantané (dépendances, contributeurs) et qu\'il manque', () => {
    expect(() => buildIssuePlan({ ...base, blockedBy: ['i-11'] }, null)).toThrow(expect.objectContaining({ statusCode: 503 }));
    expect(() => buildIssuePlan(base, null)).not.toThrow();
  });
});

describe('buildProjectInput', () => {
  it('garde nom, teams, dates et couleur valides', () => {
    expect(buildProjectInput({ teamIds: ['t'], name: 'P', startDate: '2026-10-01', targetDate: '2026-12-01', color: '#AbCdEf' }))
      .toEqual({ teamIds: ['t'], name: 'P', startDate: '2026-10-01', targetDate: '2026-12-01', color: '#AbCdEf' });
  });

  it('refuse dates invalides, échéance avant le début et couleur invalide', () => {
    for (const extra of [{ startDate: 'demain' }, { startDate: '2026-12-01', targetDate: '2026-10-01' }, { color: 'red' }]) {
      expect(() => buildProjectInput({ teamIds: ['t'], name: 'P', ...extra })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});

describe('createIssueWithExtras', () => {
  it('crée la tâche puis ajoute chaque dépendance et abonne chaque contributeur', async () => {
    const linear = fakeLinear();
    const { issue, warnings } = await createIssueWithExtras({
      linear, key: 'k', domain,
      body: { ...base, blockedBy: ['i-11', 'i-11', 'i-12'], contributorIds: ['u-sacha', 'u-louis'] },
    });
    expect(issue.id).toBe('i-new');
    expect(warnings).toEqual([]);
    expect(linear.addBlocker.mock.calls.map((c) => c.slice(1))).toEqual([['i-new', 'i-11'], ['i-new', 'i-12']]);
    expect(linear.addComment).toHaveBeenCalledWith('k', 'i-new', 'Ajouté·e·s comme contributeurs : Sacha, Louis');
    expect(linear.subscribeToIssue.mock.calls.map((c) => c[2])).toEqual(['u-sacha', 'u-louis']);
  });

  it('ne crée rien du tout quand la requête est invalide', async () => {
    const linear = fakeLinear();
    await expect(createIssueWithExtras({ linear, key: 'k', domain, body: { ...base, blockedBy: ['inconnue'] } })).rejects.toThrow();
    expect(linear.createIssue).not.toHaveBeenCalled();
  });

  it('rend en avertissements les échecs survenus après la création, sans les propager', async () => {
    const linear = fakeLinear({
      addBlocker: vi.fn(async () => { throw new Error('refusé'); }),
      addComment: vi.fn(async () => { throw new Error('quota'); }),
    });
    const { issue, warnings } = await createIssueWithExtras({
      linear, key: 'k', domain, body: { ...base, blockedBy: ['i-11'], contributorIds: ['u-sacha'] },
    });
    expect(issue.id).toBe('i-new');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/IOT-11.*refusé/);
    expect(warnings[1]).toMatch(/quota/);
  });
});

describe('withMove', () => {
  const issue = domain.issues.find((i) => i.id === 'i-11'); // t-iot, « In Progress », projet p-poc1 (t-iot seulement)

  it('laisse intact un patch qui ne touche ni la team ni le projet, sans même lire l\'instantané', () => {
    expect(withMove({ title: 'X' }, undefined, null)).toEqual({ title: 'X' });
  });

  it('déplace vers une autre team : statut équivalent choisi, projet retiré s\'il n\'existe pas là', () => {
    // La team web n'a pas de statut « started » : repli sur le premier « unstarted ».
    expect(withMove({ teamId: 't-web' }, issue, domain)).toEqual({ teamId: 't-web', stateId: 'st-web-unstarted', projectId: null });
  });

  it('choisit le statut de même type quand la team cible en a un', () => {
    const done = { ...issue, stateId: 'st-iot-completed' };
    expect(withMove({ teamId: 't-web' }, done, domain).stateId).toBe('st-web-completed');
  });

  it('garde le projet, et le statut choisi, quand ils sont valides dans la nouvelle team', () => {
    const shared = { ...domain, projects: domain.projects.map((p) => ({ ...p, teamIds: ['t-iot', 't-web'] })) };
    expect(withMove({ teamId: 't-web', stateId: 'st-web-completed' }, issue, shared))
      .toEqual({ teamId: 't-web', stateId: 'st-web-completed' });
  });

  it('accepte un retour vers la team d\'origine avec son statut et son projet d\'avant (annulation)', () => {
    const moved = { ...issue, teamId: 't-web', stateId: 'st-web-unstarted', projectId: null };
    expect(withMove({ teamId: 't-iot', stateId: 'st-iot-started', projectId: 'p-poc1' }, moved, domain))
      .toEqual({ teamId: 't-iot', stateId: 'st-iot-started', projectId: 'p-poc1' });
  });

  it('change de projet sans toucher à la team, à condition que le projet soit de cette team', () => {
    expect(withMove({ projectId: null }, issue, domain)).toEqual({ projectId: null });
    const other = { ...domain, projects: [...domain.projects, { id: 'p-web', name: 'W', teamIds: ['t-web'] }] };
    expect(() => withMove({ projectId: 'p-web' }, issue, other)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('refuse team inconnue, projet inconnu, statut d\'une autre team', () => {
    for (const patch of [{ teamId: 'inconnue' }, { projectId: 'inconnu' }, { teamId: 't-web', stateId: 'st-iot-started' }]) {
      expect(() => withMove(patch, issue, domain), JSON.stringify(patch)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('répond 503 sans instantané et 404 pour une tâche inconnue', () => {
    expect(() => withMove({ teamId: 't-web' }, issue, null)).toThrow(expect.objectContaining({ statusCode: 503 }));
    expect(() => withMove({ teamId: 't-web' }, undefined, domain)).toThrow(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('buildMilestoneInput', () => {
  it('garde projet, nom nettoyé et date valide ; la date est facultative', () => {
    expect(buildMilestoneInput({ projectId: 'p-poc1', name: '  Livraison ', targetDate: '2026-12-01' }, domain))
      .toEqual({ projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(buildMilestoneInput({ projectId: 'p-poc1', name: 'Sans date' }, domain)).toEqual({ projectId: 'p-poc1', name: 'Sans date' });
  });

  it('refuse nom vide, date impossible ; 404 projet inconnu ; 503 sans instantané', () => {
    expect(() => buildMilestoneInput({ projectId: 'p-poc1', name: '   ' }, domain)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => buildMilestoneInput({ projectId: 'p-poc1', name: 'X', targetDate: '2026-02-30' }, domain)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => buildMilestoneInput({ projectId: 'inconnu', name: 'X' }, domain)).toThrow(expect.objectContaining({ statusCode: 404 }));
    expect(() => buildMilestoneInput({ projectId: 'p-poc1', name: 'X' }, null)).toThrow(expect.objectContaining({ statusCode: 503 }));
  });
});
