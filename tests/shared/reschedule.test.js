import { describe, it, expect } from 'vitest';
import { computeReschedule, RescheduleCycleError } from '../../src/shared/reschedule.js';

const t = (id, start, end, blockedBy = []) => ({ id, start, end, blockedBy });
const none = new Set();

describe('computeReschedule', () => {
  it('decale la seule tache cible sans dependant', () => {
    const issues = [t('a', '2026-09-14', '2026-09-18')];
    expect(computeReschedule(issues, none, 'a', { start: '2026-09-16', end: '2026-09-22' }))
      .toEqual([{ issueId: 'a', oldStart: '2026-09-14', oldEnd: '2026-09-18', newStart: '2026-09-16', newEnd: '2026-09-22' }]);
  });

  it('avance transitivement toute la chaine du meme nombre de jours ouvres', () => {
    const issues = [
      t('a', '2026-09-14', '2026-09-15'),
      t('b', '2026-09-16', '2026-09-17', ['a']),
      t('c', '2026-09-18', '2026-09-21', ['b']),
    ];
    const out = computeReschedule(issues, none, 'a', { start: '2026-09-16', end: '2026-09-17' });
    expect(out).toContainEqual({ issueId: 'a', oldStart: '2026-09-14', oldEnd: '2026-09-15', newStart: '2026-09-16', newEnd: '2026-09-17' });
    expect(out).toContainEqual({ issueId: 'b', oldStart: '2026-09-16', oldEnd: '2026-09-17', newStart: '2026-09-18', newEnd: '2026-09-21' });
    expect(out).toContainEqual({ issueId: 'c', oldStart: '2026-09-18', oldEnd: '2026-09-21', newStart: '2026-09-22', newEnd: '2026-09-23' });
  });

  it('recule la chaine quand la date cible est anterieure, en sautant le week-end', () => {
    const issues = [t('a', '2026-09-16', '2026-09-16'), t('b', '2026-09-17', '2026-09-17', ['a'])];
    const out = computeReschedule(issues, none, 'a', { start: '2026-09-14', end: '2026-09-14' });
    expect(out.find((c) => c.issueId === 'b')).toMatchObject({ newStart: '2026-09-15', newEnd: '2026-09-15' });
  });

  it('ne touche pas un dependant non planifie', () => {
    const issues = [t('a', '2026-09-14', '2026-09-15'), t('b', null, null, ['a'])];
    const out = computeReschedule(issues, none, 'a', { start: '2026-09-16', end: '2026-09-17' });
    expect(out).toHaveLength(1);
  });

  it('conserve un ecart de jours ouvres au travers d un jour chome', () => {
    const holidays = new Set(['2026-11-11']);
    const issues = [t('a', '2026-11-09', '2026-11-09'), t('b', '2026-11-10', '2026-11-10', ['a'])];
    const out = computeReschedule(issues, holidays, 'a', { start: '2026-11-10', end: '2026-11-10' });
    expect(out.find((c) => c.issueId === 'b')).toMatchObject({ newStart: '2026-11-12' });
  });

  it('refuse un decalage tant qu un cycle existe dans le graphe', () => {
    const issues = [t('a', '2026-09-14', '2026-09-15', ['b']), t('b', '2026-09-16', '2026-09-17', ['a'])];
    expect(() => computeReschedule(issues, none, 'a', { start: '2026-09-16', end: '2026-09-17' }))
      .toThrow(RescheduleCycleError);
  });

  it('signale une issue cible inconnue', () => {
    expect(() => computeReschedule([], none, 'x', { start: '2026-09-14', end: '2026-09-14' })).toThrow('Issue inconnue : x');
  });
});
