import { describe, it, expect, vi } from 'vitest';
import { scopedConflicts, planIssueFix, resolveConflicts } from '../../src/ui/conflictResolution.js';

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

describe('planIssueFix', () => {
  it('décale l\'issue juste après la fin de sa bloqueuse, en gardant sa durée', () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a'] }),
      ],
    };
    expect(planIssueFix(domain, 'b')).toEqual({ issueId: 'b', start: '2026-09-19', end: '2026-09-24' });
  });

  it('avec plusieurs bloqueuses, se cale sur la plus tardive en un seul décalage', () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-10', end: '2026-09-25' }), // finit plus tard que a
        issue({ id: 'c', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a', 'b'] }),
      ],
    };
    // Se caler sur "a" seule (19/09) laisserait encore un conflit avec "b" (finit le 25/09) :
    // un seul décalage doit satisfaire les deux bloqueuses à la fois, pas une par une.
    expect(planIssueFix(domain, 'c')).toEqual({ issueId: 'c', start: '2026-09-26', end: '2026-10-01' });
  });

  it('ne bouge pas une issue déjà correctement placée par rapport à toutes ses bloqueuses', () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-19', end: '2026-09-24', blockedBy: ['a'] }),
      ],
    };
    expect(planIssueFix(domain, 'b')).toBeNull();
  });

  it('renvoie null si l\'issue a disparu ou n\'a pas de bloqueuse', () => {
    const domain = { issues: [issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' })] };
    expect(planIssueFix(domain, 'inconnue')).toBeNull();
    expect(planIssueFix(domain, 'a')).toBeNull();
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

  it('règle une issue à plusieurs bloqueuses en un seul décalage, pas un par bloqueuse', async () => {
    const domain = {
      issues: [
        issue({ id: 'a', start: '2026-09-14', end: '2026-09-18' }),
        issue({ id: 'b', start: '2026-09-10', end: '2026-09-25' }),
        issue({ id: 'c', start: '2026-09-15', end: '2026-09-20', blockedBy: ['a', 'b'] }),
      ],
    };
    const reschedule = vi.fn(async (issueId, dates) => {
      const issues = domain.issues.map((i) => (i.id === issueId ? { ...i, ...dates } : i));
      domain.issues = issues;
      return { domain: { issues } };
    });
    const result = await resolveConflicts(domain, null, reschedule);
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledWith('c', { start: '2026-09-26', end: '2026-10-01' });
    expect(result.fixed).toBe(1);
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
