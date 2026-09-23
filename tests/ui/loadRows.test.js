// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tint, renderLoadRows } from '../../src/ui/render/loadRows.js';
import { createRowSink } from '../../src/ui/render/board.js';
import { createAxis } from '../../src/ui/render/layout.js';
import { buildView } from '../../src/ui/view.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const basePlanning = (over = {}) => ({
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
  ...over,
});

function draw(planning = basePlanning(), teamScoped = false, mode = 'planned', mutate) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const view = buildView(domain, { route: { view: 'global', teamKey: null }, showCanceled: false });
  const axis = createAxis({ from: '2026-09-14', to: '2026-11-08' }, 10);
  const load = computeLoad(domain, planning, { range: axis, teamId: null });
  const left = document.createElement('div');
  const right = document.createElement('div');
  const sink = createRowSink(left, right);
  renderLoadRows(sink, { people: view.people, load, planning, axis, users: domain.users, teamScoped, mode });
  return { left, right, sink };
}

describe('tint', () => {
  it('suit les paliers de l’original', () => {
    expect(tint(101, 80).background).toBe('#B23A3A');
    expect(tint(85, 80).background).toBe('#E5B274');
    expect(tint(50, 80).background).toBe('#9CC9B2');
    expect(tint(30, 80).background).toBe('#DEECE4');
  });
});

describe('renderLoadRows', () => {
  it('ajoute un bandeau puis une ligne par personne', () => {
    const d = draw();
    expect(d.left.querySelector('.r.band').textContent).toContain('Charge prévisionnelle par personne');
    expect([...d.left.querySelectorAll('.r.ld .who b')].map((e) => e.textContent)).toEqual(['Louis', 'Sacha']);
    expect(d.sink.top).toBe(30 + 34 * 2);
  });

  it('dessine une cellule par semaine travaillée, avec heures et taux', () => {
    const d = draw();
    const cells = d.right.querySelectorAll('.r.ld')[0].querySelectorAll('.cell');
    expect(cells).toHaveLength(4);
    expect(cells[0].textContent).toBe('7,5 h27 %');
    expect(cells[0].style.left).toBe('0px');
    expect(cells[1].style.left).toBe('70px');
    expect(d.left.querySelector('.r.ld .sm').textContent).toContain('45 h sur 4 sem.');
    expect(d.left.querySelector('.r.ld .sm').textContent).toContain('pic 45 %');
  });

  it('montre les indisponibilités mais pas les semaines ajustées sans charge', () => {
    const d = draw(basePlanning({
      weeklyCapacities: [
        { linearUserId: 'u-louis', weekStart: '2026-09-21', hours: 0 },
        { linearUserId: 'u-louis', weekStart: '2026-10-12', hours: 20 },
      ],
    }));
    const cells = [...d.right.querySelectorAll('.r.ld')[0].querySelectorAll('.cell')];
    const byWeek = Object.fromEntries(cells.map((c) => [c.dataset.pw.split('|')[1], c]));
    expect(byWeek['2026-09-21'].textContent).toBe('indispo.');
    // Une capacité ajustée sur une semaine sans charge ne dessine plus de cellule dédiée :
    // seule la surcharge (indispo. / couleur) doit rester visible, pas le simple ajustement.
    expect(byWeek['2026-10-12']).toBeUndefined();
    expect(d.left.querySelector('.r.ld .sm').textContent).toContain('pic ∞');
  });

  it('précise quand la charge est limitée à une team', () => {
    expect(draw(basePlanning(), true).left.querySelector('.r.band').textContent).toContain('Charge prévisionnelle de la team');
  });
});

describe('charge prévue / réelle', () => {
  const withReal = (raw) => { raw.issues[0].description += '\nReal points: 4'; };
  const firstCell = (d) => d.right.querySelectorAll('.r.ld')[0].querySelector('.cell');

  it('propose les trois vues dans le bandeau, la vue courante étant active', () => {
    const d = draw(basePlanning(), false, 'real');
    expect([...d.left.querySelectorAll('[data-load-mode]')].map((b) => b.dataset.loadMode)).toEqual(['planned', 'real', 'both']);
    expect(d.left.querySelector('[data-load-mode].on').dataset.loadMode).toBe('real');
    expect(d.left.querySelector('.r.band').textContent).toContain('Charge réelle');
  });

  it('vue prévue : filet de charge réelle sous la cellule quand elle existe', () => {
    expect(firstCell(draw(basePlanning(), false, 'planned', withReal)).querySelector('.rl')).not.toBeNull();
    expect(firstCell(draw()).querySelector('.rl')).toBeNull();
  });

  it('vue réelle : les heures réelles, 0 tâche sans charge réelle = pas de cellule', () => {
    const none = draw(basePlanning(), false, 'real');
    expect(none.right.querySelectorAll('.cell')).toHaveLength(0);
    const some = draw(basePlanning(), false, 'real', withReal);
    expect(firstCell(some).textContent).toMatch(/h/);
    expect(some.right.querySelectorAll('.cell').length).toBeGreaterThan(0);
  });

  it('vue comparer : prévu et réel dans la même cellule', () => {
    expect(firstCell(draw(basePlanning(), false, 'both', withReal)).textContent).toMatch(/réel .* h/);
  });
});
