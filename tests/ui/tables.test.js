// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  summarize, renderFacts, renderPeopleTable, renderProjectsTable, renderLegend,
} from '../../src/ui/render/tables.js';
import { buildView } from '../../src/ui/view.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const planning = {
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
};

function context(mutate) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const view = buildView(domain, { route: { view: 'global', teamKey: null }, showCanceled: false });
  const load = computeLoad(domain, planning, { range: { from: '2026-09-14', to: '2026-11-08' }, teamId: null });
  return { domain, view, load, planning };
}

describe('summarize', () => {
  it('chiffre le périmètre de la vue', () => {
    const s = summarize(context());
    expect(s).toMatchObject({
      teams: 2, projects: 1, issues: 4, points: 16, hours: 65,
      overWeeks: 0, conflicts: 0, unplanned: 1, cycles: 0, ceiling: 80,
    });
    expect(s.peak).toBeCloseTo(44.64, 1);
  });
});

describe('rendu', () => {
  it('affiche les chiffres clés et met en alerte les non planifiées', () => {
    const el = document.createElement('div');
    renderFacts(el, summarize(context()));
    const facts = Object.fromEntries([...el.querySelectorAll('.fact')].map((f) => [f.querySelector('.l').textContent, f.querySelector('.v')]));
    expect(facts.Teams.textContent).toBe('2');
    expect(facts['Pic de charge'].textContent).toBe('45 %');
    expect(facts['Non planifiées'].classList.contains('al')).toBe(true);
    expect(facts['Liens en conflit'].classList.contains('al')).toBe(false);
  });

  it('résume chaque personne', () => {
    const tbody = document.createElement('tbody');
    renderPeopleTable(tbody, context());
    const louis = tbody.rows[0].textContent;
    expect(louis).toContain('Louis');
    expect(louis).toContain('9,0');
    expect(louis).toContain('45 h');
  });

  it('ajoute une ligne de total : points et heures sommés, semaines distinctes, pic le plus haut', () => {
    const ctx = context();
    const tbody = document.createElement('tbody');
    renderPeopleTable(tbody, ctx);
    const rows = [...tbody.rows];
    expect(rows.length).toBeGreaterThan(2);
    const total = rows.at(-1);
    expect(total.classList.contains('tot')).toBe(true);
    const cells = (row) => [...row.cells].map((c) => c.textContent);
    const num = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    const people = rows.slice(0, -1).map(cells);
    expect(cells(total)[0]).toBe('Total');
    expect(num(cells(total)[1])).toBeCloseTo(people.reduce((s, r) => s + num(r[1]), 0), 1);
    expect(num(cells(total)[2])).toBeCloseTo(summarize(ctx).hours, 0);
    // Les semaines actives ne s'additionnent pas : chacun travaille sur les mêmes semaines.
    const maxWeeks = Math.max(...people.map((r) => num(r[3])));
    const sumWeeks = people.reduce((s, r) => s + num(r[3]), 0);
    expect(num(cells(total)[3])).toBeGreaterThanOrEqual(maxWeeks);
    expect(num(cells(total)[3])).toBeLessThan(sumWeeks);
    expect(num(cells(total)[6])).toBe(Math.max(...people.map((r) => num(r[6]))));
  });

  it('n\'ajoute pas de total pour une seule personne, ni quand personne n\'a de charge', () => {
    const one = context();
    one.view = { ...one.view, people: one.view.people.slice(0, 1) };
    const a = document.createElement('tbody');
    renderPeopleTable(a, one);
    expect(a.rows).toHaveLength(1);
    expect(a.querySelector('.tot')).toBeNull();
    const none = context();
    none.view = { ...none.view, people: [] };
    const b = document.createElement('tbody');
    renderPeopleTable(b, none);
    expect(b.textContent).toContain('Personne n\'a de charge');
  });

  it('résume chaque projet avec période et jalons', () => {
    const tbody = document.createElement('tbody');
    renderProjectsTable(tbody, context());
    const text = tbody.rows[0].textContent;
    expect(text).toContain('Réalisation POC v1');
    expect(text).toContain('16/09 → 5/11');
    expect(text).toContain('Objet construit · 5/11');
    expect([...tbody.rows[0].cells].map((c) => c.textContent).slice(2, 6)).toEqual(['2', '13', '65 h', '0 %']);
  });

  it('légende les projets de la vue et le plafond', () => {
    const el = document.createElement('div');
    renderLegend(el, context());
    expect(el.textContent).toContain('Réalisation POC v1');
    expect(el.textContent).toContain('au-dessus de 80 %');
  });

});
