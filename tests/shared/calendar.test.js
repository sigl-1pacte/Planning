import { describe, it, expect } from 'vitest';
import {
  addDays, dayOfWeek, isWorkingDay, workingDays, mondayOf, daysBetween, isValidDate, todayISO,
} from '../../src/shared/calendar.js';

const none = new Set();

describe('calendar', () => {
  it('ajoute des jours en traversant les mois et le changement d\'heure', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-09-14', -1)).toBe('2026-09-13');
  });

  it('donne le jour de la semaine', () => {
    expect(dayOfWeek('2026-09-14')).toBe(1);
    expect(dayOfWeek('2026-09-13')).toBe(0);
    expect(dayOfWeek('2026-09-12')).toBe(6);
  });

  it('exclut week-ends et jours chômés', () => {
    const holidays = new Set(['2026-11-11']);
    expect(isWorkingDay('2026-09-14', none)).toBe(true);
    expect(isWorkingDay('2026-09-12', none)).toBe(false);
    expect(isWorkingDay('2026-11-11', holidays)).toBe(false);
  });

  it('liste les jours ouvrés, bornes incluses', () => {
    expect(workingDays('2026-09-11', '2026-09-14', none)).toEqual(['2026-09-11', '2026-09-14']);
    expect(workingDays('2026-11-09', '2026-11-15', new Set(['2026-11-11'])))
      .toEqual(['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13']);
    expect(workingDays('2026-09-14', '2026-09-13', none)).toEqual([]);
  });

  it('retrouve le lundi de la semaine', () => {
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
    expect(mondayOf('2026-09-13')).toBe('2026-09-07');
    expect(mondayOf('2026-09-17')).toBe('2026-09-14');
  });

  it('compte les jours entre deux dates sans dériver au changement d\'heure', () => {
    expect(daysBetween('2026-09-14', '2026-09-21')).toBe(7);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-09-21', '2026-09-14')).toBe(-7);
  });

  it('refuse les dates qui n\'existent pas', () => {
    expect(isValidDate(2026, 2, 31)).toBe(false);
    expect(isValidDate(2026, 13, 1)).toBe(false);
    expect(isValidDate(2028, 2, 29)).toBe(true);
    expect(isValidDate(2026, 9, 14)).toBe(true);
  });

  it('formate la date du jour en local', () => {
    expect(todayISO(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
  });
});
