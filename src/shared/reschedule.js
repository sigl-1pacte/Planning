import { addDays, isWorkingDay } from './calendar.js';
import { findCycles } from './dependencies.js';

export class RescheduleCycleError extends Error {
  constructor(cycle) {
    super(`Dépendances circulaires : ${cycle.join(' → ')}`);
    this.cycle = cycle;
  }
}

function shiftWorkingDays(iso, n, holidays) {
  let d = iso;
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d = addDays(d, step);
    if (isWorkingDay(d, holidays)) remaining -= 1;
  }
  return d;
}

function workingDaysBetween(a, b, holidays) {
  if (a === b) return 0;
  const step = b > a ? 1 : -1;
  let d = a;
  let count = 0;
  while (d !== b) {
    d = addDays(d, step);
    if (isWorkingDay(d, holidays)) count += step;
  }
  return count;
}

export function computeReschedule(issues, holidays, issueId, { start, end }) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const target = byId.get(issueId);
  if (!target) throw new Error(`Issue inconnue : ${issueId}`);

  const cycles = findCycles(issues);
  if (cycles.length) throw new RescheduleCycleError(cycles[0]);

  const newStart = start ?? target.start;
  const newEnd = end ?? target.end;
  const changes = new Map();
  changes.set(issueId, { issueId, oldStart: target.start, oldEnd: target.end, newStart, newEnd });

  const shift = target.start ? workingDaysBetween(target.start, newStart, holidays) : 0;
  if (shift !== 0) {
    const dependentsOf = (id) => issues.filter((i) => i.blockedBy.includes(id));
    const queue = [issueId];
    const visited = new Set([issueId]);
    while (queue.length) {
      const current = queue.shift();
      for (const dep of dependentsOf(current)) {
        if (visited.has(dep.id)) continue;
        if (dep.start && dep.end) {
          changes.set(dep.id, {
            issueId: dep.id,
            oldStart: dep.start,
            oldEnd: dep.end,
            newStart: shiftWorkingDays(dep.start, shift, holidays),
            newEnd: shiftWorkingDays(dep.end, shift, holidays),
          });
        }
        visited.add(dep.id);
        queue.push(dep.id);
      }
    }
  }
  return [...changes.values()];
}
