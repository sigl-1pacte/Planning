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

// Décale une issue au premier jour calendaire juste après la fin de sa
// bloqueuse la plus tardive — pas seulement celle d'un conflit isolé. Une
// issue avec plusieurs bloqueuses (blockedBy à plusieurs entrées) ne doit
// bouger qu'une seule fois, à la position qui satisfait TOUTES ses
// bloqueuses d'un coup ; la corriger blocageur par blocageur l'aurait fait
// déraper plus loin que nécessaire à chaque étape (et cascadé plusieurs fois
// sur ses propres dépendantes pour rien). Ne laisse aucun écart de plus
// qu'il ne faut : la nouvelle date est exactement blocker.end + 1, jamais
// une marge arbitraire.
export function planIssueFix(domain, issueId) {
  const byId = new Map(domain.issues.map((i) => [i.id, i]));
  const issue = byId.get(issueId);
  if (!issue) return null;
  // Mêmes règles que dependencyConflicts : une bloqueuse terminée/annulée ou sans
  // date ne retient personne.
  const blockers = issue.blockedBy.map((id) => byId.get(id))
    .filter((b) => b && b.end && b.status !== 'done' && b.status !== 'canceled');
  if (!blockers.length) return null;
  const requiredStart = blockers.reduce((latest, b) => {
    const next = addDays(b.end, 1);
    return next > latest ? next : latest;
  }, issue.start);
  const delta = daysBetween(issue.start, requiredStart);
  if (delta <= 0) return null;
  const { start, end } = shiftedDates(issue.start, issue.end, delta);
  return { issueId: issue.id, start, end };
}

// Issues en conflit dans le périmètre donné (une par issue, même si elle a
// plusieurs bloqueuses en conflit) — dans l'ordre où dependencyConflicts les
// rencontre, donc déterministe.
export function conflictingIssueIds(domain, teamId) {
  const seen = new Set();
  for (const c of scopedConflicts(domain, teamId)) seen.add(c.issueId);
  return [...seen];
}

// Résout, dans le périmètre donné, les issues en conflit une par une (un
// décalage peut faire apparaître ou disparaître d'autres conflits plus loin
// dans la chaîne, donc on relit l'état après chaque écriture plutôt que de
// calculer tous les décalages à l'avance). `reschedule(issueId, dates)` doit
// renvoyer { domain }, comme la route d'écriture réelle. Bloqué net par un
// cycle de dépendances n'importe où dans le workspace (computeReschedule
// refuse toute replanification tant qu'il en existe un) — mieux vaut le
// signaler que de laisser échouer chaque tentative une par une.
export async function resolveConflicts(domain, teamId, reschedule, { maxIterations = 50 } = {}) {
  if (findCycles(domain.issues).length) {
    return { domain, fixed: 0, originals: [], blockedByCycle: true };
  }
  let current = domain;
  const originals = [];
  for (let i = 0; i < maxIterations; i += 1) {
    const [issueId] = conflictingIssueIds(current, teamId);
    if (!issueId) break;
    const fix = planIssueFix(current, issueId);
    if (!fix) break;
    const original = current.issues.find((iss) => iss.id === fix.issueId);
    const result = await reschedule(fix.issueId, { start: fix.start, end: fix.end });
    if (!result?.domain) break;
    current = result.domain;
    originals.push({ issueId: fix.issueId, start: original.start, end: original.end });
  }
  return { domain: current, fixed: originals.length, originals, blockedByCycle: false };
}
