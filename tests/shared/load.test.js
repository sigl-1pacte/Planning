import { describe, it, expect } from 'vitest';
import {
  planningRange, weeklyHours, defaultWeeklyHours, shareWeights, computeLoad, personStats,
} from '../../src/shared/load.js';

const planning = (over = {}) => ({
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
  ...over,
});

const issue = (over) => ({
  id: 'i1', teamId: 't1', status: 'todo', estimate: 8,
  start: '2026-09-16', end: '2026-09-25', contributorIds: ['u1', 'u2'],
  ...over,
});

const domain = (issues, over = {}) => ({
  teams: [], projects: [],
  users: [{ id: 'u1' }, { id: 'u2' }],
  issues,
  ...over,
});

describe('planningRange', () => {
  it('couvre issues planifiées, projets et jalons, calé sur des semaines entières', () => {
    const d = domain([issue(), issue({ id: 'i2', start: null, end: null })], {
      projects: [{ startDate: null, targetDate: '2026-11-04', milestones: [{ date: '2026-11-05' }] }],
    });
    expect(planningRange(d)).toEqual({ from: '2026-09-14', to: '2026-11-08' });
  });

  it('renvoie null sans aucune date', () => {
    expect(planningRange(domain([issue({ start: null, end: null })]))).toBeNull();
  });
});

describe('capacités', () => {
  const p = planning({
    people: [{ linearUserId: 'u1', role: null, defaultWeeklyHours: 20, active: true }],
    weeklyCapacities: [{ linearUserId: 'u1', weekStart: '2026-09-21', hours: 0 }],
  });

  it('prend la capacité exceptionnelle, puis celle de la personne, puis le réglage global', () => {
    expect(weeklyHours('u1', '2026-09-21', p)).toBe(0);
    expect(weeklyHours('u1', '2026-09-14', p)).toBe(20);
    expect(weeklyHours('u2', '2026-09-14', p)).toBe(28);
    expect(defaultWeeklyHours('u1', p)).toBe(20);
  });
});

describe('shareWeights', () => {
  it('répartit à parts égales sans dérogation', () => {
    expect(shareWeights(issue(), [])).toEqual({ u1: 0.5, u2: 0.5 });
  });

  it('applique les dérogations et ignore les anciens contributeurs', () => {
    const rows = [
      { issueId: 'i1', linearUserId: 'u1', share: 75 },
      { issueId: 'i1', linearUserId: 'u2', share: 25 },
      { issueId: 'i1', linearUserId: 'parti', share: 400 },
      { issueId: 'autre', linearUserId: 'u1', share: 1 },
    ];
    expect(shareWeights(issue(), rows)).toEqual({ u1: 0.75, u2: 0.25 });
  });

  it('donne 100/n à un contributeur ajouté après les dérogations', () => {
    const rows = [{ issueId: 'i1', linearUserId: 'u1', share: 50 }];
    const w = shareWeights(issue({ contributorIds: ['u1', 'u2', 'u3'] }), rows);
    expect(w.u1).toBeCloseTo(50 / (50 + 100 / 3 * 2));
    expect(w.u1 + w.u2 + w.u3).toBeCloseTo(1);
  });

  it('renvoie un objet vide sans contributeur', () => {
    expect(shareWeights(issue({ contributorIds: [] }), [])).toEqual({});
  });
});

describe('computeLoad', () => {
  const range = { from: '2026-09-14', to: '2026-09-27' };

  it('répartit les heures par personne, par jour ouvré et par semaine', () => {
    const r = computeLoad(domain([issue()]), planning(), { range });
    expect(r.issues.i1.hours).toBe(40);
    expect(r.issues.i1.days).toHaveLength(8);
    expect(r.issues.i1.perPerson.u1).toEqual({ hours: 20, ratePct: 45 });
    expect(r.weeks).toEqual(['2026-09-14', '2026-09-21']);
    const [w1, w2] = r.people.u1;
    expect(w1.hours).toBeCloseTo(7.5);
    expect(w1.capacity).toBeCloseTo(28);
    expect(w1.pct).toBeCloseTo(26.79, 1);
    expect(w2.hours).toBeCloseTo(12.5);
    expect(w1.unavailable).toBe(false);
  });

  it('réduit la capacité d\'une semaine qui contient un jour chômé', () => {
    const r = computeLoad(domain([]), planning({ holidays: [{ day: '2026-11-11', label: 'Armistice' }] }), {
      range: { from: '2026-11-09', to: '2026-11-15' },
    });
    expect(r.people.u1[0].capacity).toBeCloseTo(22.4);
  });

  it('marque indisponible une semaine à capacité nulle qui reçoit du travail', () => {
    const p = planning({ weeklyCapacities: [{ linearUserId: 'u1', weekStart: '2026-09-21', hours: 0 }] });
    const w2 = computeLoad(domain([issue()]), p, { range }).people.u1[1];
    expect(w2.capacity).toBe(0);
    expect(w2.pct).toBe(Infinity);
    expect(w2.unavailable).toBe(true);
  });

  it('exclut les issues non planifiées et annulées, et compte 0 heure sans estimation', () => {
    const r = computeLoad(domain([
      issue({ id: 'a', start: null, end: null }),
      issue({ id: 'b', status: 'canceled' }),
      issue({ id: 'c', estimate: null }),
    ]), planning(), { range });
    expect(Object.keys(r.issues)).toEqual(['c']);
    expect(r.issues.c.hours).toBe(0);
    expect(r.people.u1.every((w) => w.hours === 0)).toBe(true);
  });

  it('ne compte que la team demandée, sans toucher à la capacité', () => {
    const d = domain([issue(), issue({ id: 'i2', teamId: 't2' })]);
    const all = computeLoad(d, planning(), { range }).people.u1[0];
    const team = computeLoad(d, planning(), { range, teamId: 't1' }).people.u1[0];
    expect(all.hours).toBeCloseTo(15);
    expect(team.hours).toBeCloseTo(7.5);
    expect(team.capacity).toBeCloseTo(all.capacity);
  });
});

describe('personStats', () => {
  it('résume total, semaines actives, pic et moyenne', () => {
    const rows = [
      { hours: 0, pct: 0 },
      { hours: 14, pct: 50 },
      { hours: 21, pct: 75 },
    ];
    expect(personStats(rows)).toEqual({ total: 35, activeWeeks: 2, peakPct: 75, avgPct: 62.5 });
  });
});
