// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatFr, parseFr, maskFr, stepDate, unitAt, enhanceDateFields } from '../../src/ui/dateField.js';

describe('jj/mm/aaaa', () => {
  it('formate et relit sans confondre jour et mois', () => {
    expect(formatFr('2026-09-12')).toBe('12/09/2026');
    expect(parseFr('12/09/2026')).toBe('2026-09-12');
    expect(parseFr('09/12/2026')).toBe('2026-12-09');
  });

  it('refuse le incomplet et l\'impossible', () => {
    for (const bad of ['', '12/09', '31/02/2026', '12/13/2026', '1/9/2026', 'ab/cd/efgh']) expect(parseFr(bad), bad).toBeNull();
  });

  it('pose les « / » à la frappe et ignore le reste', () => {
    expect(maskFr('12092026')).toBe('12/09/2026');
    expect(maskFr('1209')).toBe('12/09');
    expect(maskFr('12')).toBe('12');
    expect(maskFr('12/09/20269999')).toBe('12/09/2026');
    expect(maskFr('a1b2')).toBe('12');
  });

  it('trouve le segment sous le curseur', () => {
    expect([0, 1, 2].map(unitAt)).toEqual(['day', 'day', 'day']);
    expect([3, 4, 5].map(unitAt)).toEqual(['month', 'month', 'month']);
    expect([6, 8, 10].map(unitAt)).toEqual(['year', 'year', 'year']);
  });
});

describe('stepDate', () => {
  it('le jour change vraiment d\'un jour, en franchissant les fins de mois', () => {
    expect(stepDate('2026-09-12', 'day', 1)).toBe('2026-09-13');
    expect(stepDate('2026-09-30', 'day', 1)).toBe('2026-10-01');
    expect(stepDate('2026-10-01', 'day', -1)).toBe('2026-09-30');
  });

  it('le mois ne touche pas au jour, sauf pour rester dans le mois', () => {
    expect(stepDate('2026-09-12', 'month', 1)).toBe('2026-10-12');
    expect(stepDate('2026-12-12', 'month', 1)).toBe('2027-01-12');
    expect(stepDate('2026-01-12', 'month', -1)).toBe('2025-12-12');
    expect(stepDate('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(stepDate('2028-01-31', 'month', 1)).toBe('2028-02-29');
  });

  it('l\'année ne touche ni au jour ni au mois, sauf le 29 février', () => {
    expect(stepDate('2026-09-12', 'year', 1)).toBe('2027-09-12');
    expect(stepDate('2028-02-29', 'year', 1)).toBe('2029-02-28');
  });
});

describe('champ de date dans la page', () => {
  let native;
  let text;
  let changes;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="dfield"><input id="d" type="date" data-field="d" value="2026-09-16"><span class="dovl">x</span></div>';
    enhanceDateFields(document.body);
    native = document.querySelector('[data-field="d"]');
    text = document.querySelector('.dtxt');
    changes = [];
    native.addEventListener('change', () => changes.push(native.value));
  });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  const press = (key, pos) => {
    text.setSelectionRange(pos, pos);
    text.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const type = (value) => { text.value = value; text.dispatchEvent(new Event('input', { bubbles: true })); };

  it('affiche la date en jj/mm/aaaa, reprend l\'id pour le label et retire l\'ancien texte superposé', () => {
    expect(text.value).toBe('16/09/2026');
    expect(text.id).toBe('d');
    expect(native.id).toBe('');
    expect(document.querySelector('.dovl')).toBeNull();
  });

  it('ne s\'applique qu\'une fois par champ', () => {
    enhanceDateFields(document.body);
    expect(document.querySelectorAll('.dtxt')).toHaveLength(1);
  });

  it('flèche haut sur le jour : +1 jour, pas +1 mois', () => {
    press('ArrowUp', 1);
    expect(native.value).toBe('2026-09-17');
    expect(text.value).toBe('17/09/2026');
  });

  it('flèche haut sur le mois : +1 mois, pas +1 jour', () => {
    press('ArrowUp', 4);
    expect(native.value).toBe('2026-10-16');
    press('ArrowDown', 4);
    press('ArrowDown', 4);
    expect(native.value).toBe('2026-08-16');
  });

  it('flèche sur l\'année, et garde le segment sélectionné', () => {
    press('ArrowUp', 8);
    expect(native.value).toBe('2027-09-16');
    expect([text.selectionStart, text.selectionEnd]).toEqual([6, 10]);
  });

  it('n\'émet « change » qu\'une fois, quand on lâche les flèches', () => {
    press('ArrowUp', 1);
    press('ArrowUp', 1);
    press('ArrowUp', 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(changes).toEqual(['2026-09-19']);
  });

  it('valide tout de suite une date complète tapée à la main', () => {
    type('01102026');
    expect(text.value).toBe('01/10/2026');
    expect(native.value).toBe('2026-10-01');
    expect(changes).toEqual(['2026-10-01']);
  });

  it('ne change pas la valeur tant que la saisie est incomplète ou impossible', () => {
    type('3102');
    type('31/02/2026');
    expect(native.value).toBe('2026-09-16');
    expect(text.hasAttribute('aria-invalid')).toBe(true);
    expect(changes).toEqual([]);
  });

  it('revient à la dernière date valide en quittant une saisie invalide', () => {
    type('31/02/2026');
    text.dispatchEvent(new Event('blur'));
    expect(text.value).toBe('16/09/2026');
    expect(text.hasAttribute('aria-invalid')).toBe(false);
  });

  it('effacer le champ vide la date', () => {
    type('');
    expect(native.value).toBe('');
    expect(changes).toEqual(['']);
  });

  it('flèche sur un champ vide part d\'aujourd\'hui', () => {
    native.value = '';
    text.value = '';
    press('ArrowUp', 0);
    expect(native.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reflète un choix fait dans le calendrier natif', () => {
    native.value = '2026-12-25';
    native.dispatchEvent(new Event('input', { bubbles: true }));
    expect(text.value).toBe('25/12/2026');
  });
});
