import { daysBetween, addDays, isWorkingDay } from '../../shared/calendar.js';

export const MIN_DAY_WIDTH = 2;
export const MAX_DAY_WIDTH = 60;
export const ZOOM_PRESETS = { quarter: 91, month: 31 };

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const clamp = (w) => Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, w));

export function dayWidthFor(zoom, { viewportWidth, days, customWidth }) {
  if (zoom === 'custom') return clamp(customWidth ?? viewportWidth / days);
  if (zoom === 'all') return clamp(viewportWidth / days);
  return clamp(viewportWidth / ZOOM_PRESETS[zoom]);
}

export function createAxis(range, dayWidth) {
  const days = daysBetween(range.from, range.to) + 1;
  return { from: range.from, to: range.to, days, dayWidth, width: days * dayWidth };
}

export const dayIndex = (axis, iso) => daysBetween(axis.from, iso);
export const xOf = (axis, iso) => dayIndex(axis, iso) * axis.dayWidth;

export function barSegments(axis, start, end, holidays) {
  const runs = [];
  let current = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const i = dayIndex(axis, d);
    if (isWorkingDay(d, holidays)) {
      if (current) current.last = i;
      else current = { first: i, last: i };
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs.map((r) => ({
    left: r.first * axis.dayWidth,
    width: Math.max(2, (r.last - r.first + 1) * axis.dayWidth),
  }));
}

export function todayX(axis, todayIso) {
  const i = dayIndex(axis, todayIso);
  return i < 0 || i >= axis.days ? null : (i + 0.5) * axis.dayWidth;
}

export function scrollLeftForToday(axis, todayIso, viewportWidth) {
  const x = todayX(axis, todayIso);
  if (x === null) return 0;
  return Math.max(0, Math.min(axis.width - viewportWidth, x - viewportWidth / 2));
}

export function monthSpans(axis) {
  const out = [];
  let first = `${axis.from.slice(0, 8)}01`;
  while (first <= axis.to) {
    const [y, m] = first.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const a = Math.max(0, dayIndex(axis, first));
    const b = Math.min(axis.days, dayIndex(axis, next));
    const width = (b - a) * axis.dayWidth;
    if (width > 4) {
      out.push({ left: a * axis.dayWidth, width, label: `${width < 105 ? MONTHS_SHORT[m - 1] : MONTHS[m - 1]} ${y}` });
    }
    first = next;
  }
  return out;
}

export function weekTicks(axis) {
  const out = [];
  for (let w = axis.from; w <= axis.to; w = addDays(w, 7)) {
    const [, m, d] = w.split('-');
    const width = 7 * axis.dayWidth;
    out.push({
      left: dayIndex(axis, w) * axis.dayWidth,
      width,
      label: width > 26 ? `${Number(d)}/${m}` : '',
      monthStart: Number(d) <= 7,
    });
  }
  return out;
}
