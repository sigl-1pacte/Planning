const DAY_MS = 86_400_000;

export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(toUTC(iso) + n * DAY_MS);
}

export function dayOfWeek(iso) {
  return new Date(toUTC(iso)).getUTCDay();
}

export function isWorkingDay(iso, holidays) {
  const w = dayOfWeek(iso);
  return w !== 0 && w !== 6 && !holidays.has(iso);
}

export function workingDays(from, to, holidays) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, holidays)) out.push(d);
  }
  return out;
}

export function mondayOf(iso) {
  const w = dayOfWeek(iso);
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function isValidDate(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

// La date du jour dépend du fuseau de la personne qui regarde, pas de l'UTC.
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
