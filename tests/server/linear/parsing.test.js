import { describe, it, expect } from 'vitest';
import { parseStartingDate, parseContributors, resolveMention } from '../../../src/server/linear/parsing.js';

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
  it('prend le commentaire le plus récent qui contient la ligne', () => {
    const comments = [
      { id: 'c1', body: 'Contributors: @sacha', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'c2', body: 'Point d\'étape\nContributors: @louis @maxou', createdAt: '2026-09-03T10:00:00Z' },
      { id: 'c3', body: 'Un avis sans ligne', createdAt: '2026-09-05T10:00:00Z' },
    ];
    expect(parseContributors(comments, users)).toEqual({
      found: true, commentId: 'c2', userIds: ['u2', 'u3'], unresolved: [],
    });
  });

  it('dédoublonne et signale les mentions non résolues', () => {
    const comments = [{ id: 'c1', body: 'contributors : @sacha @Sacha @fantome', createdAt: '2026-09-01T10:00:00Z' }];
    expect(parseContributors(comments, users)).toEqual({
      found: true, commentId: 'c1', userIds: ['u1'], unresolved: ['fantome'],
    });
  });

  it('reconnaît une mention placée dans un lien markdown', () => {
    const comments = [{ id: 'c1', body: 'Contributors: [@sacha](https://linear.app/x/profiles/sacha)', createdAt: '2026-09-01T10:00:00Z' }];
    expect(parseContributors(comments, users).userIds).toEqual(['u1']);
  });

  it('indique l\'absence de ligne', () => {
    expect(parseContributors([], users)).toEqual({ found: false, commentId: null, userIds: [], unresolved: [] });
  });
});
