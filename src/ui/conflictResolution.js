import { addDays, daysBetween } from '../shared/calendar.js';
import { dependencyConflicts, findCycles } from '../shared/dependencies.js';
import { shiftedDates } from './dragReschedule.js';

// Conflits (dépendante qui démarre avant la fin de sa bloqueuse) limités à
// une team quand une seule est affichée — sur la vue globale, tous.
export function scopedConflicts(domain, teamId) {
  const conflicts = dependencyConflicts(domain.issues);
  if (teamId === null) return conflicts;
  const byId = new Map(domain.issues.map((i) => [i.id, i]));
  return conflicts.filter((c) => byId.get(c.issueId)?.teamId === teamId);
}

// Décale la dépendante au premier jour calendaire après la fin de sa
// bloqueuse, en gardant sa durée — même logique que le glisser-déposer
// (jours calendaires, pas de bornage aux jours ouvrés).
export function planConflictFix(domain, conflict) {
  const byId = new Map(domain.issues.map((i) => [i.id, i]));
  const issue = byId.get(conflict.issueId);
  const blocker = byId.get(conflict.blockerId);
  if (!issue || !blocker) return null;
  const newStart = addDays(blocker.end, 1);
  const delta = daysBetween(issue.start, newStart);
  if (delta === 0) return null;
  const { start, end } = shiftedDates(issue.start, issue.end, delta);
  return { issueId: issue.id, start, end };
}

// Résout, dans le périmètre donné, les conflits un par un (chaque décalage
// peut faire apparaître ou disparaître d'autres conflits en cascade, donc on
// relit l'état après chaque écriture plutôt que de calculer tous les
// décalages à l'avance). `reschedule(issueId, dates)` doit renvoyer
// { domain }, comme la route d'écriture réelle. Bloqué net par un cycle de
// dépendances n'importe où dans le workspace (computeReschedule refuse toute
// replanification tant qu'il en existe un) — mieux vaut le signaler que de
// laisser échouer chaque tentative une par une.
export async function resolveConflicts(domain, teamId, reschedule, { maxIterations = 50 } = {}) {
  if (findCycles(domain.issues).length) {
    return { domain, fixed: 0, originals: [], blockedByCycle: true };
  }
  let current = domain;
  const originals = [];
  for (let i = 0; i < maxIterations; i += 1) {
    const conflicts = scopedConflicts(current, teamId);
    if (!conflicts.length) break;
    const fix = planConflictFix(current, conflicts[0]);
    if (!fix) break;
    const original = current.issues.find((iss) => iss.id === fix.issueId);
    const result = await reschedule(fix.issueId, { start: fix.start, end: fix.end });
    if (!result?.domain) break;
    current = result.domain;
    originals.push({ issueId: fix.issueId, start: original.start, end: original.end });
  }
  return { domain: current, fixed: originals.length, originals, blockedByCycle: false };
}
