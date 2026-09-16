import { addDays } from '../shared/calendar.js';

export function dayDeltaFromPixels(deltaPx, dayWidth) {
  return dayWidth > 0 ? Math.round(deltaPx / dayWidth) : 0;
}

export function shiftedDates(start, end, dayDelta) {
  return { start: addDays(start, dayDelta), end: addDays(end, dayDelta) };
}

// Dépendantes transitives d'une issue (celles qui seraient décalées en
// cascade si on la replanifie) — même parcours que computeReschedule côté
// serveur (src/shared/reschedule.js), sans le calcul de dates : sert
// uniquement à savoir, pendant un glisser-déposer, quelles lignes prévisualiser
// en mouvement avec la barre déplacée.
export function transitiveDependents(issues, issueId) {
  const dependentsOf = (id) => issues.filter((i) => i.blockedBy.includes(id));
  const visited = new Set([issueId]);
  const queue = [issueId];
  while (queue.length) {
    const current = queue.shift();
    for (const dep of dependentsOf(current)) {
      if (visited.has(dep.id)) continue;
      visited.add(dep.id);
      queue.push(dep.id);
    }
  }
  visited.delete(issueId);
  return [...visited];
}
