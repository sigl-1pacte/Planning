import { describe, it, expect } from 'vitest';
import { parseStartingDate, parseContributors, resolveMention, setStartingDate } from '../../../src/server/linear/parsing.js';

const users = [
  { id: 'u1', name: 'Sacha Martin', displayName: 'sacha', email: 'sacha.martin@ex.fr' },
  { id: 'u2', name: 'Louis', displayName: null, email: 'l.dupont@ex.fr' },
  { id: 'u3', name: 'Maxime', displayName: 'maxou', email: 'maxime@ex.fr' },
];

describe('parseStartingDate', () => {
  it('lit la date au format JJ/MM/AAAA', () => {
    expect(parseStartingDate('Contexte\nStarting date: 16/09/2026\nSuite'))
      .toEqual({ ok: true, date: '2026-09-16' });
  });

  it('accepte un jour et un mois sur un chiffre, la casse et les espaces', () => {
    expect(parseStartingDate('  starting DATE :  2/3/2027  ')).toEqual({ ok: true, date: '2027-03-02' });
  });

  it('retient la première ligne valide', () => {
    expect(parseStartingDate('Starting date: 01/10/2026\nStarting date: 05/10/2026'))
      .toEqual({ ok: true, date: '2026-10-01' });
  });

  it('signale une description vide ou sans ligne', () => {
    expect(parseStartingDate(null).ok).toBe(false);
    expect(parseStartingDate('rien ici')).toEqual({
      ok: false, reason: 'Aucune ligne « Starting date » dans la description',
    });
  });

  it('signale une ligne illisible sans inventer de date', () => {
    expect(parseStartingDate('Starting date: 2026-09-16')).toEqual({
      ok: false, reason: 'Ligne « Starting date » illisible : « 2026-09-16 »',
    });
  });

  it('refuse une date impossible au lieu de la faire glisser', () => {
    expect(parseStartingDate('Starting date: 31/02/2026')).toEqual({
      ok: false, reason: 'Date de début impossible : 31/02/2026',
    });
  });
});

describe('resolveMention', () => {
  it('résout par displayName, puis name, puis partie locale de l\'e-mail', () => {
    expect(resolveMention('SACHA', users).id).toBe('u1');
    expect(resolveMention('louis', users).id).toBe('u2');
    expect(resolveMention('l.dupont', users).id).toBe('u2');
    expect(resolveMention('inconnu', users)).toBeNull();
  });
});

describe('parseContributors', () => {
  it('lit la ligne dans la description', () => {
    expect(parseContributors('Point d\'étape\nContributors: @louis @maxou\nSuite', users))
      .toEqual({ userIds: ['u2', 'u3'], unresolved: [] });
  });

  it('dédoublonne et signale les mentions non résolues', () => {
    expect(parseContributors('contributors : @sacha @Sacha @fantome', users))
      .toEqual({ userIds: ['u1'], unresolved: ['fantome'] });
  });

  it('reconnaît une mention placée dans un lien markdown', () => {
    expect(parseContributors('Contributors: [@sacha](https://linear.app/x/profiles/sacha)', users).userIds)
      .toEqual(['u1']);
  });

  it('indique l\'absence de ligne', () => {
    expect(parseContributors(null, users)).toEqual({ userIds: [], unresolved: [] });
    expect(parseContributors('rien ici', users)).toEqual({ userIds: [], unresolved: [] });
  });

  it('coexiste avec la ligne Starting date dans la même description', () => {
    const description = 'Starting date: 16/09/2026\nContributors: @sacha @louis\nContexte';
    expect(parseStartingDate(description)).toEqual({ ok: true, date: '2026-09-16' });
    expect(parseContributors(description, users)).toEqual({ userIds: ['u1', 'u2'], unresolved: [] });
  });
});

describe('setStartingDate', () => {
  it('remplace une ligne valide existante sans toucher au reste', () => {
    expect(setStartingDate('Avant\nStarting date: 01/10/2026\nAprès', '2026-11-05'))
      .toBe('Avant\nStarting date: 05/11/2026\nAprès');
  });

  it('remplace une ligne illisible existante', () => {
    expect(setStartingDate('Starting date: pas une date\nSuite', '2026-11-05'))
      .toBe('Starting date: 05/11/2026\nSuite');
  });

  it('insère la ligne en tête quand aucune ligne n\'existe', () => {
    expect(setStartingDate('Contexte du projet', '2026-11-05'))
      .toBe('Starting date: 05/11/2026\n\nContexte du projet');
  });

  it('produit uniquement la ligne pour une description vide ou absente', () => {
    expect(setStartingDate('', '2026-11-05')).toBe('Starting date: 05/11/2026');
    expect(setStartingDate(null, '2026-11-05')).toBe('Starting date: 05/11/2026');
  });
});
