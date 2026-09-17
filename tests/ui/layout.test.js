import { describe, it, expect } from 'vitest';
import {
  dayWidthFor, createAxis, xOf, barSegments, todayX, scrollLeftForToday, monthSpans, weekTicks,
} from '../../src/ui/render/layout.js';

const range = { from: '2026-09-14', to: '2026-10-11' }; // 28 jours

describe('dayWidthFor', () => {
  it("fait tenir toute la plage en mode « tout »", () => {
    expect(dayWidthFor('all', { viewportWidth: 840, days: 28 })).toBe(30);
    expect(dayWidthFor('all', { viewportWidth: 900, days: 3 })).toBe(60);
    expect(dayWidthFor('all', { viewportWidth: 900, days: 1000 })).toBe(2);
  });

  it("applique les préréglages et le réglage libre dans les bornes", () => {
    expect(dayWidthFor('quarter', { viewportWidth: 910, days: 400 })).toBe(10);
    expect(dayWidthFor('month', { viewportWidth: 930, days: 400 })).toBe(30);
    expect(dayWidthFor('custom', { viewportWidth: 900, days: 400, customWidth: 90 })).toBe(60);
    expect(dayWidthFor('custom', { viewportWidth: 900, days: 400, customWidth: 12 })).toBe(12);
  });
});

describe('axe', () => {
  const axis = createAxis(range, 10);

  it("mesure la plage", () => {
    expect(axis).toEqual({ from: '2026-09-14', to: '2026-10-11', days: 28, dayWidth: 10, width: 280 });
    expect(xOf(axis, '2026-09-16')).toBe(20);
  });

  it("coupe les barres aux week-ends et jours chômés", () => {
    expect(barSegments(axis, '2026-09-17', '2026-09-22', new Set())).toEqual([
      { left: 30, width: 20 },
      { left: 70, width: 20 },
    ]);
    expect(barSegments(axis, '2026-09-14', '2026-09-16', new Set(['2026-09-15']))).toEqual([
      { left: 0, width: 10 },
      { left: 20, width: 10 },
    ]);
  });

  it("garde une largeur minimale visible", () => {
    expect(barSegments(createAxis(range, 1), '2026-09-14', '2026-09-14', new Set())).toEqual([{ left: 0, width: 2 }]);
  });

  it("place la ligne du jour au milieu de sa colonne, ou nulle part hors plage", () => {
    expect(todayX(axis, '2026-09-14')).toBe(5);
    expect(todayX(axis, '2026-10-11')).toBe(275);
    expect(todayX(axis, '2026-10-12')).toBeNull();
    expect(todayX(axis, '2026-09-13')).toBeNull();
  });

  it("centre le défilement sur aujourd'hui sans sortir de la frise", () => {
    expect(scrollLeftForToday(axis, '2026-09-28', 100)).toBe(95);
    expect(scrollLeftForToday(axis, '2026-09-14', 100)).toBe(0);
    expect(scrollLeftForToday(axis, '2026-10-11', 100)).toBe(180);
    expect(scrollLeftForToday(axis, '2027-01-01', 100)).toBe(0);
  });

  it("découpe les mois et les semaines", () => {
    expect(monthSpans(axis)).toEqual([
      { left: 0, width: 170, label: 'septembre 2026' },
      { left: 170, width: 110, label: 'octobre 2026' },
    ]);
    const ticks = weekTicks(axis);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toEqual({ left: 0, width: 70, label: '14/09', monthStart: false });
    expect(ticks[3]).toEqual({ left: 210, width: 70, label: '5/10', monthStart: true });
  });

  it("abrège les mois étroits et masque les semaines illisibles", () => {
    const narrow = createAxis(range, 3);
    expect(monthSpans(narrow)[1].label).toBe('oct. 2026');
    expect(weekTicks(narrow)[0].label).toBe('');
  });
});
