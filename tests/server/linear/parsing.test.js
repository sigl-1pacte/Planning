import { describe, it, expect } from 'vitest';
import { parseStartingDate, parseContributors, resolveMention, setStartingDate, setContributors, parseDescriptionText, setDescriptionText, parseRealPoints, setRealPoints } from '../../../src/server/linear/parsing.js';

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

describe('setContributors', () => {
  it('remplace une ligne existante sans toucher au reste', () => {
    expect(setContributors('Starting date: 16/09/2026\nContributors: @sacha\nContexte', [users[1], users[2]]))
      .toBe('Starting date: 16/09/2026\nContributors: @Louis @maxou\nContexte');
  });

  it('ajoute la ligne à la fin quand aucune ligne n\'existe', () => {
    expect(setContributors('Starting date: 16/09/2026', [users[0]]))
      .toBe('Starting date: 16/09/2026\n\nContributors: @sacha');
  });

  it('produit uniquement la ligne pour une description vide ou absente', () => {
    expect(setContributors('', [users[0]])).toBe('Contributors: @sacha');
    expect(setContributors(null, [users[0]])).toBe('Contributors: @sacha');
  });

  it('utilise le nom complet si la personne n\'a pas de displayName', () => {
    expect(setContributors(null, [users[1]])).toBe('Contributors: @Louis');
  });

  it('retire la ligne (sans laisser de blanc) quand la liste est vide', () => {
    expect(setContributors('Avant\nContributors: @sacha\nAprès', [])).toBe('Avant\nAprès');
    expect(setContributors('Contributors: @sacha', [])).toBe('');
  });

  it('ne touche rien quand la liste est déjà vide et qu\'il n\'y a pas de ligne', () => {
    expect(setContributors('Rien ici', [])).toBe('Rien ici');
    expect(setContributors(null, [])).toBe('');
  });
});

describe('texte libre de la description', () => {
  const raw = 'Débattre de l\'architecture\nsuite du texte\nStarting date: 12/09/2026\nContributors: @sacha @louis';

  it('extrait le texte libre sans les lignes structurées', () => {
    expect(parseDescriptionText(raw)).toBe('Débattre de l\'architecture\nsuite du texte');
    expect(parseDescriptionText('Starting date: 12/09/2026')).toBe('');
    expect(parseDescriptionText(null)).toBe('');
  });

  it('remplace le texte en gardant Starting date et Contributors', () => {
    expect(setDescriptionText(raw, 'Nouveau texte')).toBe('Nouveau texte\n\nStarting date: 12/09/2026\nContributors: @sacha @louis');
  });

  it('un texte vide ne laisse que les lignes structurées, et une description absente donne juste le texte', () => {
    expect(setDescriptionText(raw, '  ')).toBe('Starting date: 12/09/2026\nContributors: @sacha @louis');
    expect(setDescriptionText(null, 'Seul')).toBe('Seul');
  });

  it('ne perd pas une ligne « Starting date » illisible', () => {
    expect(setDescriptionText('Starting date: bientôt\nAncien', 'Neuf')).toBe('Neuf\n\nStarting date: bientôt');
  });
});

describe('charge réelle (Real points)', () => {
  it('lit la ligne, avec virgule ou point, et rend null sinon', () => {
    expect(parseRealPoints('Texte\nReal points: 5\nStarting date: 12/09/2026')).toBe(5);
    expect(parseRealPoints('Real points: 2,5')).toBe(2.5);
    expect(parseRealPoints('Real points: beaucoup')).toBeNull();
    expect(parseRealPoints(null)).toBeNull();
  });

  it('pose, remplace et retire la ligne sans toucher au reste', () => {
    expect(setRealPoints('Texte', 3)).toBe('Texte\nReal points: 3');
    expect(setRealPoints('Texte\nReal points: 3', 8)).toBe('Texte\nReal points: 8');
    expect(setRealPoints('Texte\nReal points: 3\nContributors: @a', null)).toBe('Texte\nContributors: @a');
    expect(setRealPoints(null, null)).toBe('');
    expect(setRealPoints(null, 2)).toBe('Real points: 2');
  });

  it('la ligne ne fait pas partie du texte libre et survit à son édition', () => {
    const raw = 'Texte\nReal points: 3\nStarting date: 12/09/2026';
    expect(parseDescriptionText(raw)).toBe('Texte');
    expect(setDescriptionText(raw, 'Neuf')).toBe('Neuf\n\nReal points: 3\nStarting date: 12/09/2026');
  });
});
