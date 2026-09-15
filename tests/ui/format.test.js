import { describe, it, expect } from 'vitest';
import { esc, initials, shortDay, longDay, ddmmyyyy, fr1, issueStatus, personColor } from '../../src/ui/render/format.js';

describe('format', () => {
  it('échappe le HTML', () => {
    expect(esc('<a href="x">l\'eau & co</a>')).toBe('&lt;a href=&quot;x&quot;&gt;l&#39;eau &amp; co&lt;/a&gt;');
    expect(esc(null)).toBe('');
  });

  it('calcule les initiales', () => {
    expect(initials({ name: 'Maxence Cosaque' })).toBe('MC');
    expect(initials({ name: 'Louis' })).toBe('L');
    expect(initials({ name: '  ' })).toBe('??');
    expect(initials(undefined)).toBe('??');
  });

  it('formate dates et nombres à la française', () => {
    expect(shortDay('2026-09-05')).toBe('5/09');
    expect(longDay('2026-09-05')).toBe('5 septembre 2026');
    expect(ddmmyyyy('2026-09-05')).toBe('05/09/2026');
    expect(fr1(7.5)).toBe('7,5');
  });

  it('dérive le statut bloqué sauf pour une tâche close', () => {
    const blocked = new Set(['a', 'b']);
    expect(issueStatus({ id: 'a', status: 'doing' }, blocked)).toBe('blocked');
    expect(issueStatus({ id: 'b', status: 'done' }, blocked)).toBe('done');
    expect(issueStatus({ id: 'c', status: 'todo' }, blocked)).toBe('todo');
  });

  it('attribue une couleur stable par personne', () => {
    const users = [{ id: 'u1' }, { id: 'u2' }];
    expect(personColor('u2', users)).toBe(personColor('u2', users));
    expect(personColor('u1', users)).not.toBe(personColor('u2', users));
  });
});
