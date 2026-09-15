import { describe, it, expect, vi } from 'vitest';
import { scopedConflicts, planConflictFix, resolveConflicts } from '../../src/ui/conflictResolution.js';

const issue = (over) => ({
  id: over.id, identifier: over.id, teamId: 't1', status: 'todo',
  start: over.start, end: over.end, blockedBy: over.blockedBy ?? [], estimate: 1,
  ...over,
});

describe('scopedConflicts', () => {
  it('remonte tous les conflits sur la vue globale', () => {
    const domain = {
      issues: [
        issue({ id: 'a', teamId: 't1', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', teamId: 't1', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
        issue({ id: 'c', teamId: 't2', start: '2026-09-10', end: '2026-09-12' }),
        issue({ id: 'd', teamId: 't2', start: '2026-09-11', end: '2026-09-14', blockedBy: ['c'] }),
      ],
    };
    expect(scopedConflicts(domain, null)).toEqual([
      { issueId: 'b', blockerId: 'a' },
      { issueId: 'd', blockerId: 'c' },
    ]);
  });

  it('limite à une team', () => {
    const domain = {
      issues: [
        issue({ id: 'a', teamId: 't1', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', teamId: 't1', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
        issue({ id: 'c', teamId: 't2', start: '2026-09-10', end: '2026-09-12' }),
        issue({ id: 'd', teamId: 't2', start: '2026-09-11', end: '2026-09-14', blockedBy: ['c'] }),
      ],
    };
    expect(scopedConflicts(domain, 't2')).toEqual([{ issueId: 'd', blockerId: 'c' }]);
  });
});

describe('planConflictFix', () => {
  it('décale la dépendante juste après la fin de sa bloqueuse, en gardant sa durée', () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
      ],
    };
    expect(planConflictFix(domain, { issueId: 'b', blockerId: 'a' }))
      .toEqual({ issueId: 'b', start: '2026-09-19', end: '2026-09-24' });
  });

  it('renvoie null si l\'issue ou la bloqueuse a disparu', () => {
    const domain = { issues: [issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' })] };
    expect(planConflictFix(domain, { issueId: 'b', blockerId: 'a' })).toBeNull();
  });
});

describe('resolveConflicts', () => {
  it('résout les conflits un par un, en relisant le domaine après chaque écriture', async () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
        issue({ id: 'c', start: '2026-09-16', end: '2026-09-17', blockedBy: ['b'] }),
      ],
    };
    const reschedule = vi.fn(async (issueId, dates) => {
      const issues = domain.issues.map((i) => (i.id === issueId ? { ...i, ...dates } : i));
      domain.issues = issues;
      return { domain: { issues } };
    });
    const result = await resolveConflicts(domain, null, reschedule);
    expect(result.fixed).toBe(2);
    expect(reschedule).toHaveBeenCalledTimes(2);
    expect(reschedule).toHaveBeenNthCalledWith(1, 'b', { start: '2026-09-19', end: '2026-09-24' });
    // c dépend de b, décalée au tour précédent : son conflit avec b apparaît
    // seulement après ce premier décalage, d'où la relecture entre chaque tour.
    expect(reschedule).toHaveBeenNthCalledWith(2, 'c', { start: '2026-09-25', end: '2026-09-26' });
    expect(result.originals).toEqual([
      { issueId: 'b', start: '2026-09-15', end: '2026-09-20' },
      { issueId: 'c', start: '2026-09-16', end: '2026-09-17' },
    ]);
  });

  it('ne touche rien sans conflit', async () => {
    const domain = { issues: [issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' })] };
    const reschedule = vi.fn();
    const result = await resolveConflicts(domain, null, reschedule);
    expect(result).toEqual({ domain, fixed: 0, originals: [], blockedByCycle: false });
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('refuse tant qu\'un cycle existe, sans tenter aucune écriture', async () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-15', blockedBy: ['b'] }),
        issue({ id: 'b', start: '2026-09-16', end: '2026-09-17', blockedBy: ['a'] }),
      ],
    };
    const reschedule = vi.fn();
    const result = await resolveConflicts(domain, null, reschedule);
    expect(result.blockedByCycle).toBe(true);
    expect(result.fixed).toBe(0);
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('limite au périmètre demandé', async () => {
    const domain = {
      issues: [
        issue({ id: 'a', teamId: 't1', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', teamId: 't1', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
        issue({ id: 'c', teamId: 't2', start: '2026-09-10', end: '2026-09-12' }),
        issue({ id: 'd', teamId: 't2', start: '2026-09-11', end: '2026-09-14', blockedBy: ['c'] }),
      ],
    };
    const reschedule = vi.fn(async (issueId, dates) => {
      const issues = domain.issues.map((i) => (i.id === issueId ? { ...i, ...dates } : i));
      domain.issues = issues;
      return { domain: { issues } };
    });
    const result = await resolveConflicts(domain, 't2', reschedule);
    expect(result.fixed).toBe(1);
    expect(reschedule).toHaveBeenCalledWith('d', { start: '2026-09-13', end: '2026-09-16' });
  });
});
