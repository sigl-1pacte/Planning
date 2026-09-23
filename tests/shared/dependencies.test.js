import { describe, it, expect } from 'vitest';
import { dependencyConflicts, blockedIssueIds, findCycles } from '../../src/shared/dependencies.js';

const t = (id, start, end, blockedBy = []) => ({ id, start, end, blockedBy });

describe('dependencyConflicts', () => {
  it('signale une tâche qui commence strictement avant la fin du bloqueur', () => {
    const issues = [
      t('a', '2026-09-14', '2026-09-18'),
      t('b', '2026-09-17', '2026-09-22', ['a']),
      t('c', '2026-09-21', '2026-09-25', ['a']),
    ];
    expect(dependencyConflicts(issues)).toEqual([{ issueId: 'b', blockerId: 'a' }]);
    expect([...blockedIssueIds(issues)]).toEqual(['b']);
  });

  it('un passage de relais le jour même, ou le lendemain, n\'est pas un conflit', () => {
    const issues = [
      t('a', '2026-09-14', '2026-09-18'),
      t('same', '2026-09-18', '2026-09-22', ['a']),
      t('next', '2026-09-19', '2026-09-22', ['a']),
    ];
    expect(dependencyConflicts(issues)).toEqual([]);
  });

  it('ignore les tâches terminées ou annulées, comme bloqueuses et comme dépendantes', () => {
    const s = (id, start, end, status, blockedBy = []) => ({ id, start, end, status, blockedBy });
    const issues = [
      s('a', '2026-09-14', '2026-09-30', 'canceled'),
      s('b', '2026-09-20', '2026-09-25', 'todo', ['a']),
      s('c', '2026-09-14', '2026-09-30', 'done'),
      s('d', '2026-09-20', '2026-09-25', 'todo', ['c']),
      s('e', '2026-09-14', '2026-09-30', 'todo'),
      s('f', '2026-09-20', '2026-09-25', 'done', ['e']),
      s('g', '2026-09-20', '2026-09-25', 'todo', ['e']),
    ];
    expect(dependencyConflicts(issues)).toEqual([{ issueId: 'g', blockerId: 'e' }]);
  });

  it('ignore les tâches non planifiées et les bloqueurs inconnus', () => {
    const issues = [
      t('a', null, null),
      t('b', '2026-09-14', '2026-09-15', ['a', 'fantome']),
      t('c', null, null, ['b']),
    ];
    expect(dependencyConflicts(issues)).toEqual([]);
  });
});

describe('findCycles', () => {
  it('ne trouve rien dans un graphe acyclique', () => {
    expect(findCycles([t('a', null, null), t('b', null, null, ['a']), t('c', null, null, ['a', 'b'])])).toEqual([]);
  });

  it('trouve un cycle une seule fois', () => {
    const cycles = findCycles([t('a', null, null, ['c']), t('b', null, null, ['a']), t('c', null, null, ['b'])]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]].sort()).toEqual(['a', 'b', 'c']);
  });

  it('trouve une boucle sur soi-même et plusieurs cycles distincts', () => {
    const cycles = findCycles([
      t('a', null, null, ['a']),
      t('b', null, null, ['c']), t('c', null, null, ['b']),
    ]);
    expect(cycles.map((c) => [...c].sort().join(','))).toEqual(['a', 'b,c']);
  });
});
