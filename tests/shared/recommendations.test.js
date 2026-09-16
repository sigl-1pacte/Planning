import { describe, it, expect } from 'vitest';
import { latestEndDates, suggestReschedules, suggestContributorSwaps } from '../../src/shared/recommendations.js';
import { computeLoad } from '../../src/shared/load.js';
import { daysBetween } from '../../src/shared/calendar.js';

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

describe('suggestReschedules', () => {
  it('propose de décaler la tâche la plus flexible d\'une semaine en surcharge, dans sa marge', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    // u1 seul, 35h/semaine ; une tâche de 40 points (200h) sur 2026-09-14
    // (lundi) → 2026-09-18 (vendredi) sature largement cette semaine, et n'a
    // aucune échéance de projet : marge illimitée, donc décalable sans risque.
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1'],
    })];
    const domain = domainFor(issues, users);
    const range = { from: '2026-09-14', to: '2026-09-20' };
    const load = computeLoad(domain, planning(), { range, teamId: null });
    const suggestions = suggestReschedules(domain, load, 80, { teamId: null });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].issueId).toBe('a');
    expect(daysBetween(suggestions[0].currentStart, suggestions[0].suggestedStart)).toBeGreaterThan(0);
  });

  it('ne propose rien si personne n\'est en surcharge', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    const issues = [issue({ id: 'a', start: '2026-09-14', end: '2026-09-15', estimate: 2, contributorIds: ['u1'] })];
    const domain = domainFor(issues, users);
    const load = computeLoad(domain, planning(), { range: { from: '2026-09-14', to: '2026-09-20' }, teamId: null });
    expect(suggestReschedules(domain, load, 80, { teamId: null })).toEqual([]);
  });

  it('ne propose pas une tâche sans aucune marge (échéance de projet déjà au ras)', () => {
    const users = [{ id: 'u1', name: 'U1' }];
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1'], projectId: 'p1',
    })];
    const projects = [{ id: 'p1', targetDate: '2026-09-18' }];
    const domain = domainFor(issues, users, projects);
    const load = computeLoad(domain, planning(), { range: { from: '2026-09-14', to: '2026-09-20' }, teamId: null });
    expect(suggestReschedules(domain, load, 80, { teamId: null })).toEqual([]);
  });
});

describe('suggestContributorSwaps', () => {
  it('propose de transférer la charge vers un co-contributeur qui a de la marge', () => {
    const users = [{ id: 'u1', name: 'Surchargé' }, { id: 'u2', name: 'Disponible' }];
    const issues = [issue({
      id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1', 'u2'],
    })];
    const domain = domainFor(issues, users);
    // Répartition très inégale (95 / 5) : u1 porte l'essentiel de la charge
    // et sature largement, u2 garde une vraie marge sur cette même tâche.
    const contributions = [
      { issueId: 'a', linearUserId: 'u1', share: 95 },
      { issueId: 'a', linearUserId: 'u2', share: 5 },
    ];
    const load = computeLoad(domain, planning({ contributions }), { range: { from: '2026-09-14', to: '2026-09-20' }, teamId: null });
    const suggestions = suggestContributorSwaps(domain, load, 80, { teamId: null });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ issueId: 'a', fromUserId: 'u1', toUserId: 'u2' });
  });

  it('ne propose rien pour une tâche à contributeur unique', () => {
    const users = [{ id: 'u1', name: 'Seul' }];
    const issues = [issue({ id: 'a', start: '2026-09-14', end: '2026-09-18', estimate: 40, contributorIds: ['u1'] })];
    const domain = domainFor(issues, users);
    const load = computeLoad(domain, planning(), { range: { from: '2026-09-14', to: '2026-09-20' }, teamId: null });
    expect(suggestContributorSwaps(domain, load, 80, { teamId: null })).toEqual([]);
  });
});
