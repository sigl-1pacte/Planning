import { describe, it, expect } from 'vitest';
import { dayDeltaFromPixels, shiftedDates } from '../../src/ui/dragReschedule.js';

describe('dayDeltaFromPixels', () => {
  it('arrondit au jour le plus proche', () => {
    expect(dayDeltaFromPixels(0, 20)).toBe(0);
    expect(dayDeltaFromPixels(9, 20)).toBe(0);
    expect(dayDeltaFromPixels(11, 20)).toBe(1);
    expect(dayDeltaFromPixels(-25, 20)).toBe(-1);
    expect(dayDeltaFromPixels(-35, 20)).toBe(-2);
  });

  it('reste à zéro sans largeur de jour valide', () => {
    expect(dayDeltaFromPixels(100, 0)).toBe(0);
  });
});

describe('shiftedDates', () => {
  it('décale début et échéance du même nombre de jours calendaires', () => {
    expect(shiftedDates('2026-09-16', '2026-09-25', 3)).toEqual({ start: '2026-09-19', end: '2026-09-28' });
    expect(shiftedDates('2026-09-16', '2026-09-25', -2)).toEqual({ start: '2026-09-14', end: '2026-09-23' });
    expect(shiftedDates('2026-09-16', '2026-09-25', 0)).toEqual({ start: '2026-09-16', end: '2026-09-25' });
  });
});
