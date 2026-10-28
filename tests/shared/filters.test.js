import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER, PRESETS, describeFilter, isEmptyFilter, issueFilter, normalizeFilter, sameFilter,
} from '../../src/shared/filters.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

// IOT-11 en cours (Sacha, Louis) 16/09 → 25/09 ; IOT-12 à faire (Louis)
// 28/09 → 09/10 ; IOT-13 non planifiée, sans contributeur ; WEB-1 terminée,
// sans projet ni contributeur, 21/09 → 22/09.
const domain = mapWorkspace(rawWorkspace());
const kept = (filter, { me = 'u-sacha', today = '2026-09-30' } = {}) => {
  const keep = issueFilter(filter, { me, today });
  return domain.issues.filter((i) => !keep || keep(i)).map((i) => i.identifier);
};
const F = (over) => ({ ...EMPTY_FILTER, ...over });

describe('filtres', () => {
  it('un filtre vide ne filtre rien', () => {
    expect(issueFilter(EMPTY_FILTER, { me: null, today: '2026-09-30' })).toBeNull();
    expect(isEmptyFilter({ q: '   ' })).toBe(true);
  });

  it('personne : moi, quelqu\'un, personne', () => {
    expect(kept(F({ people: ['me'] }))).toEqual(['IOT-11']);
    expect(kept(F({ people: ['u-louis'] }))).toEqual(['IOT-11', 'IOT-12']);
    expect(kept(F({ people: ['nobody'] }))).toEqual(['IOT-13', 'WEB-1']);
    expect(kept(F({ people: ['me', 'nobody'] }))).toEqual(['IOT-11', 'IOT-13', 'WEB-1']);
    expect(kept(F({ people: ['me'] }), { me: null })).toEqual([]);
  });

  it('projet, et sans projet', () => {
    expect(kept(F({ projects: ['p-poc1'] }))).toEqual(['IOT-11', 'IOT-12', 'IOT-13']);
    expect(kept(F({ projects: ['none'] }))).toEqual(['WEB-1']);
  });

  it('échéance : en retard (hors terminées), cette semaine, 2 semaines, non planifiées', () => {
    expect(kept(F({ due: 'overdue' }))).toEqual(['IOT-11']);
    expect(kept(F({ due: 'week' }), { today: '2026-09-23' })).toEqual(['IOT-11', 'WEB-1']);
    expect(kept(F({ due: 'two-weeks' }), { today: '2026-09-23' })).toEqual(['IOT-11', 'IOT-12']);
    expect(kept(F({ due: 'unplanned' }))).toEqual(['IOT-13']);
  });

  it('recherche dans l\'identifiant et le titre, sans casse ni accents', () => {
    expect(kept(F({ q: 'iot-1' }))).toEqual(['IOT-11', 'IOT-12', 'IOT-13']);
    expect(kept(F({ q: 'CONCÉPTION' }))).toEqual(['IOT-11']);
  });

  it('les critères se cumulent', () => {
    expect(kept(F({ people: ['u-louis'], due: 'overdue' }))).toEqual(['IOT-11']);
    expect(kept(F({ people: ['u-louis'], q: 'soft' }))).toEqual(['IOT-12']);
  });

  it('normalise ce qui vient d\'ailleurs, et compare sans tenir compte de l\'ordre', () => {
    expect(normalizeFilter({ people: ['b', 'a', 'a', 3, ''], due: 'demain', q: '  x ', extra: 1 }))
      .toEqual({ people: ['a', 'b'], projects: [], due: null, q: 'x' });
    expect(normalizeFilter(null)).toEqual(EMPTY_FILTER);
    expect(sameFilter({ people: ['b', 'a'] }, { people: ['a', 'b'], q: '' })).toBe(true);
  });

  it('vues par défaut et description lisible', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Mes tâches', 'En retard', 'Cette semaine', 'Sans contributeur']);
    expect(describeFilter(F({ people: ['me', 'u-louis'], projects: ['none'], due: 'week', q: 'x' }), domain))
      .toBe('personne : moi, Louis · projet : sans projet · échéance : cette semaine · recherche : « x »');
  });
});
