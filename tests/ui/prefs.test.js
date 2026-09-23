import { describe, it, expect } from 'vitest';
import { loadPrefs, savePrefs } from '../../src/ui/prefs.js';

const storage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('prefs', () => {
  it('fournit des valeurs par défaut', () => {
    expect(loadPrefs(storage())).toEqual({
      zoom: 'all', dayWidth: null, collapsed: [], showCanceled: false, lastRoute: '#/', loadMode: 'planned',
    });
  });

  it('relit ce qui a été enregistré', () => {
    const s = storage();
    savePrefs({ ...loadPrefs(s), zoom: 'month', collapsed: ['p1'] }, s);
    expect(loadPrefs(s).zoom).toBe('month');
    expect(loadPrefs(s).collapsed).toEqual(['p1']);
  });

  it('ignore un contenu corrompu', () => {
    const s = storage();
    s.setItem('planning.prefs', '{pas du json');
    expect(loadPrefs(s).zoom).toBe('all');
  });
});
