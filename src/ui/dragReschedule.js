import { addDays } from '../shared/calendar.js';

export function dayDeltaFromPixels(deltaPx, dayWidth) {
  return dayWidth > 0 ? Math.round(deltaPx / dayWidth) : 0;
}

export function shiftedDates(start, end, dayDelta) {
  return { start: addDays(start, dayDelta), end: addDays(end, dayDelta) };
}
