// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderLoadChart } from '../../src/ui/render/loadChart.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const RANGE = { from: '2026-09-14', to: '2026-11-08' };

const planning = (over = {}) => ({
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
  ...over,
});

function draw({ mutate, teamScoped = false, teamId = null, planningOver = {}, onApply = vi.fn() } = {}) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const p = planning(planningOver);
  const load = computeLoad(domain, p, { range: RANGE, teamId });
  const container = document.createElement('div');
  const people = domain.users;
  renderLoadChart(container, {
    domain, planning: p, load, people, users: domain.users,
    ceiling: p.settings.loadCeilingPct, teamScoped, teamId, range: RANGE, onApply,
  });
  return container;
}

describe('renderLoadChart', () => {
  it('signale l’absence de recommandation sur un périmètre sans surcharge', () => {
    const container = draw();
    expect(container.textContent).toContain('Recommandations');
    expect(container.textContent).toContain('Rien à signaler');
    expect(container.querySelectorAll('.recorow')).toHaveLength(0);
  });

  it('trace le graphe agrégé charge vs disponibilité', () => {
    const container = draw();
    expect(container.querySelector('.chsvg')).not.toBeNull();
  });

  it('montre la charge de chacun semaine par semaine, puis total, pic et moyenne', () => {
    const container = draw();
    const rows = [...container.querySelectorAll('.hm-row:not(.hm-head)')];
    expect(rows.map((r) => r.querySelector('.hm-who span:last-child').textContent)).toEqual(['Louis', 'Sacha']);
    const weeks = container.querySelectorAll('.hm-head .hm-wk').length;
    expect(weeks).toBeGreaterThan(0);
    expect(rows[0].querySelectorAll('.hm-c')).toHaveLength(weeks);
    expect(rows[0].querySelector('.hm-n').textContent).toMatch(/h$/);
  });

  it('résume la surcharge en chiffres clés', () => {
    const calm = draw();
    expect(calm.querySelector('.ch-tile b').textContent).toBe('0 h');
    const busy = draw({ mutate: (raw) => { raw.issues[0].estimate = 400; } });
    expect(busy.querySelector('.ch-tile.hot b').textContent).toMatch(/^\d+ h$/);
    expect(busy.querySelector('.hm-c.over')).not.toBeNull();
  });

  it('ombre dans le graphe les semaines où quelqu\'un dépasse le plafond, même si l\'équipe reste dessous', () => {
    const busy = draw({ mutate: (raw) => { raw.issues[0].estimate = 400; } });
    expect(busy.querySelectorAll('.chsvg .ch-band').length).toBeGreaterThan(0);
    expect(draw().querySelectorAll('.chsvg .ch-band')).toHaveLength(0);
  });

  it('adapte le titre à une vue par team', () => {
    const container = draw({ teamScoped: true, teamId: 't-iot' });
    expect(container.querySelector('.ch-scope').textContent).toContain('Team affichée');
  });

  it('propose une action mesurée et actionnable quand une semaine est en surcharge', () => {
    // i-11 seule (estimation 8 -> 40h) sur une semaine ne sature pas assez ;
    // on grossit son estimation pour provoquer une vraie surcharge, sans
    // échéance de projet qui l'empêcherait de glisser.
    const container = draw({ mutate: (raw) => { raw.issues[0].estimate = 400; } });
    const row = container.querySelector('.recorow');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('IOT-11');
    expect(row.querySelector('.reco-gain b').textContent).toMatch(/^−\d+ h$/);
    expect(row.querySelector('.reco-detail').textContent).toMatch(/\d+ (janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)/);
    const btn = row.querySelector('[data-action="apply-reco"]');
    expect(btn).not.toBeNull();
  });

  it('déclenche onApply avec la recommandation choisie au clic', () => {
    const onApply = vi.fn();
    const container = draw({ mutate: (raw) => { raw.issues[0].estimate = 400; }, onApply });
    container.querySelector('[data-action="apply-reco"]').click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(typeof onApply.mock.calls[0][0].apply).toBe('function');
  });
});
