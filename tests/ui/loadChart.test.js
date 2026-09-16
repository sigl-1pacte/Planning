// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderLoadChart } from '../../src/ui/render/loadChart.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const planning = (over = {}) => ({
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
  ...over,
});

function draw({ mutate, teamScoped = false, teamId = null, planningOver = {} } = {}) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const range = { from: '2026-09-14', to: '2026-11-08' };
  const load = computeLoad(domain, planning(planningOver), { range, teamId });
  const container = document.createElement('div');
  const people = domain.users;
  renderLoadChart(container, {
    domain, load, people, users: domain.users,
    ceiling: planning(planningOver).settings.loadCeilingPct, teamScoped, teamId,
  });
  return container;
}

describe('renderLoadChart', () => {
  it('signale l’absence de recommandation sur un périmètre sans surcharge', () => {
    const container = draw();
    expect(container.querySelector('h3').textContent).toContain('Recommandations');
    expect(container.textContent).toContain('Rien à signaler');
    expect(container.querySelectorAll('.recorow')).toHaveLength(0);
  });

  it('résume chaque personne (total, pic, moyenne)', () => {
    const container = draw();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.cells[0].textContent.trim())).toEqual(['L Louis', 'S Sacha']);
    expect(rows[0].cells[1].textContent).toMatch(/h$/);
  });

  it('adapte le titre à une vue par team', () => {
    const container = draw({ teamScoped: true, teamId: 't-iot' });
    expect(container.querySelector('h3').textContent).toContain('pour la team');
  });

  it('propose une replanification actionnable quand une semaine est en surcharge', () => {
    // i-11 seule (estimation 8 -> 40h) sur une semaine ne sature pas assez ;
    // on grossit son estimation pour provoquer une vraie surcharge, sans
    // échéance de projet qui l'empêcherait de glisser.
    const container = draw({ mutate: (raw) => { raw.issues[0].estimate = 400; } });
    const row = container.querySelector('.recorow');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('IOT-11');
    const btn = row.querySelector('[data-action="apply-reschedule"]');
    expect(btn.dataset.issue).toBe('i-11');
    expect(btn.dataset.start > '2026-09-16').toBe(true);
  });
});
