import { describe, it, expect } from 'vitest';
import { planPrintColumns, sliceRows, printTimelineWidth } from '../../src/ui/print.js';

describe('planPrintColumns', () => {
  it('garde toute la plage sur une largeur de page quand le jour reste lisible', () => {
    const plan = planPrintColumns({ from: '2026-09-07', to: '2026-12-20' }, 700);
    expect(plan.columns).toEqual([{ from: '2026-09-07', to: '2026-12-20' }]);
    expect(plan.dayWidth).toBeCloseTo(700 / 105);
  });

  it('ne dépasse pas la largeur de jour maximale sur une plage courte', () => {
    expect(planPrintColumns({ from: '2026-09-14', to: '2026-09-20' }, 700).dayWidth).toBe(60);
  });

  it('découpe une longue plage en début de mois, en colonnes équilibrées', () => {
    // 7 sept. 2026 → 20 juin 2027 : trois colonnes, pas deux pleines et une
    // presque vide.
    const plan = planPrintColumns({ from: '2026-09-07', to: '2027-06-20' }, 700);
    expect(plan.columns).toEqual([
      { from: '2026-09-07', to: '2026-11-30' },
      { from: '2026-12-01', to: '2027-02-28' },
      { from: '2027-03-01', to: '2027-06-20' },
    ]);
    expect(plan.dayWidth).toBeCloseTo(700 / 112);
    expect(plan.dayWidth).toBeGreaterThanOrEqual(5);
  });
});

describe('sliceRows', () => {
  it('regroupe les lignes sans en couper une, avec un budget réduit pour la première tranche', () => {
    expect(sliceRows([30, 28, 24, 24, 24, 24], 80, 60)).toEqual([
      { top: 0, height: 58 },
      { top: 58, height: 72 },
      { top: 130, height: 24 },
    ]);
  });

  it('garde une ligne plus haute que le budget sur sa propre tranche', () => {
    expect(sliceRows([100, 10], 50)).toEqual([{ top: 0, height: 100 }, { top: 100, height: 10 }]);
  });
});

describe('printTimelineWidth', () => {
  it('laisse la place de la colonne des tâches sur une page A4 paysage', () => {
    expect(printTimelineWidth(601)).toBe(695);
  });
});
