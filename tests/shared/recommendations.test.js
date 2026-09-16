import { describe, it, expect } from 'vitest';
import { latestEndDates, buildRecommendations } from '../../src/shared/recommendations.js';
import { computeLoad } from '../../src/shared/load.js';

const issue = (over) => ({
  id: over.id, identifier: over.id.toUpperCase(), title: over.title ?? over.id, teamId: 't1',
  projectId: over.projectId ?? null, status: over.status ?? 'todo', estimate: over.estimate ?? 5,
  start: over.start, end: over.end, blockedBy: over.blockedBy ?? [], contributorIds: over.contributorIds ?? [],
  ...over,
});

describe('latestEndDates', () => {
  it('n\'impose aucune limite sans échéance de projet ni dépendante', () => {
    const issues = [issue({ id: 'a', start: '2026-09-01', end: '2026-09-05' })];
    expect(latestEndDates(issues).get('a')).toBe('9999-12-31');
  });

  it('se limite à l\'échéance de son propre projet sans dépendante', () => {
    const issues = [issue({ id: 'a', start: '2026-09-01', end: '2026-09-05', projectTargetDate: '2026-10-10' })];
    expect(latestEndDates(issues).get('a')).toBe('2026-10-10');
  });

  it('se limite à ce que sa dépendante impose, même sans échéance propre', () => {
    const issues = [
      issue({ id: 'a', start: '2026-09-01', end: '2026-09-05' }),
      issue({ id: 'b', start: '2026-09-06', end: '2026-09-10', blockedBy: ['a'], projectTargetDate: '2026-09-20' }),
    ];
    const latest = latestEndDates(issues);
    expect(latest.get('b')).toBe('2026-09-20');
    // b dure 4 jours (06→10) et doit finir au plus tard le 20 : elle doit
    // donc démarrer au plus tard le 16, donc a doit finir au plus tard le 15.
    expect(latest.get('a')).toBe('2026-09-15');
  });

  it('ne boucle pas indéfiniment sur un cycle de dépendances', () => {
    const issues = [
      issue({ id: 'a', start: '2026-09-01', end: '2026-09-05', blockedBy: ['b'] }),
      issue({ id: 'b', start: '2026-09-06', end: '2026-09-10', blockedBy: ['a'] }),
    ];
    expect(() => latestEndDates(issues)).not.toThrow();
  });
});

const planning = (over = {}) => ({
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 35 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
  ...over,
});

function domainFor(issues, users, projects = []) {
  return { issues, users, projects, teams: [{ id: 't1', key: 'T1', name: 'T1' }], workflowStates: [] };
}

const RANGE = { from: '2026-09-14', to: '2026-09-27' };

describe('buildRecommendations', () => {
  it('ne signale rien quand personne ne dépasse le plafond', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    const issues = [issue({ id: 'a', start: '2026-09-14', end: '2026-09-15', estimate: 2, contributorIds: ['u1'] })];
    const domain = domainFor(issues, users);
    const load = computeLoad(domain, planning(), { range: RANGE, teamId: null });
    const result = buildRecommendations(domain, planning(), load, 80, { teamId: null, range: RANGE });
    expect(result.recommendations).toEqual([]);
    expect(result.overloadBefore).toBe(0);
    expect(result.stillOverloaded).toBe(false);
  });

  it('propose d\'étaler la tâche la plus flexible d\'une semaine en surcharge, et mesure un vrai gain', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    // u1 seul, 35h/semaine ; une tâche de 40 points (200h) sur 2026-09-14
    // (lundi) → 2026-09-18 (vendredi) sature largement cette semaine, et n'a
    // aucune échéance de projet : marge illimitée, donc étalable sans risque.
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1'],
    })];
    const domain = domainFor(issues, users);
    const load = computeLoad(domain, planning(), { range: RANGE, teamId: null });
    const result = buildRecommendations(domain, planning(), load, 80, { teamId: null, range: RANGE });
    expect(result.recommendations.length).toBeGreaterThan(0);
    const first = result.recommendations[0];
    expect(['stretch', 'move']).toContain(first.kind);
    expect(first.gainHours).toBeGreaterThan(0);
    expect(typeof first.apply).toBe('function');
  });

  it('ne propose pas de décalage pour une tâche sans aucune marge, mais retombe sur la capacité en dernier recours', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1'], projectId: 'p1',
    })];
    const projects = [{ id: 'p1', targetDate: '2026-09-18' }];
    const domain = domainFor(issues, users, projects);
    const load = computeLoad(domain, planning(), { range: RANGE, teamId: null });
    const result = buildRecommendations(domain, planning(), load, 80, { teamId: null, range: RANGE });
    expect(result.recommendations.some((r) => r.kind === 'stretch' || r.kind === 'move')).toBe(false);
    expect(result.overloadBefore).toBeGreaterThan(0);
    // Seul un contributeur, sans marge : le seul levier restant est la
    // capacité, jamais préférée mais utilisée quand rien d'autre n'aide.
    expect(result.recommendations.every((r) => r.kind === 'capacity')).toBe(true);
    expect(result.stillOverloaded).toBe(false);
  });

  it('propose de transférer de la charge vers un co-contributeur qui a de la marge', () => {
    const users = [{ id: 'u1', name: 'Surchargé' }, { id: 'u2', name: 'Disponible' }];
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1', 'u2'], projectId: 'p1',
    })];
    // Marge nulle (fin d'issue = échéance du projet) pour écarter étaler et
    // décaler : seul le rééquilibrage des parts peut réduire la surcharge.
    const projects = [{ id: 'p1', targetDate: '2026-09-18' }];
    const domain = domainFor(issues, users, projects);
    // Répartition très inégale (95 / 5) : u1 porte l'essentiel de la charge
    // et sature largement, u2 garde une vraie marge sur cette même tâche.
    const contributions = [
      { issueId: 'a', linearUserId: 'u1', share: 95 },
      { issueId: 'a', linearUserId: 'u2', share: 5 },
    ];
    const load = computeLoad(domain, planning({ contributions }), { range: RANGE, teamId: null });
    const result = buildRecommendations(domain, planning({ contributions }), load, 80, { teamId: null, range: RANGE });
    expect(result.recommendations.some((r) => r.kind === 'rebalance')).toBe(true);
  });
});
