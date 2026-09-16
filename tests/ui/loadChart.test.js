// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderLoadChart } from '../../src/ui/render/loadChart.js';
import { createAxis } from '../../src/ui/render/layout.js';
import { buildView } from '../../src/ui/view.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const planning = {
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
};

function draw(teamScoped = false, teamId = null) {
  const domain = mapWorkspace(rawWorkspace());
  const view = buildView(domain, { route: { view: 'global', teamKey: null }, showCanceled: false });
  const axis = createAxis({ from: '2026-09-14', to: '2026-11-08' }, 10);
  const load = computeLoad(domain, planning, { range: axis, teamId });
  const container = document.createElement('div');
  renderLoadChart(container, { load, people: view.people, users: domain.users, ceiling: planning.settings.loadCeilingPct, teamScoped });
  return container;
}

describe('renderLoadChart', () => {
  it('dessine une barre par semaine avec disponibilité et charge', () => {
    const container = draw();
    const bars = container.querySelectorAll('.lcbar');
    expect(bars.length).toBeGreaterThan(0);
    const first = bars[0];
    expect(first.querySelector('.lccap')).not.toBeNull();
    expect(first.querySelector('.lcload')).not.toBeNull();
    expect(first.title).toMatch(/h chargées.*h disponibles/);
  });

  it('résume chaque personne (total, pic, moyenne)', () => {
    const container = draw();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.cells[0].textContent.trim())).toEqual(['L Louis', 'S Sacha']);
    expect(rows[0].cells[1].textContent).toMatch(/h$/);
  });

  it('adapte le titre à une vue par team', () => {
    const container = draw(true, 't-iot');
    expect(container.querySelector('h3').textContent).toContain('de la team');
  });

  it('n’explose pas sans personne dans le périmètre', () => {
    const container = document.createElement('div');
    const domain = mapWorkspace(rawWorkspace());
    const axis = createAxis({ from: '2026-09-14', to: '2026-09-21' }, 10);
    const load = computeLoad(domain, planning, { range: axis, teamId: null });
    renderLoadChart(container, { load, people: [], users: domain.users, ceiling: 80, teamScoped: false });
    expect(container.querySelectorAll('.lcbar')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
