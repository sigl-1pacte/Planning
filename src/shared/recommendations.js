import { addDays, daysBetween, isWorkingDay } from './calendar.js';
import { computeLoad } from './load.js';

const FAR_FUTURE = '9999-12-31';

// Date de fin au plus tard qu'une issue peut tenir sans repousser l'échéance
// de son propre projet, ni forcer une de ses dépendantes à démarrer plus
// tard que ce que celle-ci peut elle-même tenir — un calcul de type chemin
// critique, remonté depuis les tâches sans dépendante ("feuilles") vers les
// racines. Une issue sans projet à échéance et sans dépendante n'a aucune
// contrainte connue : elle reçoit FAR_FUTURE (marge considérée illimitée).
export function latestEndDates(issues) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const dependentsOf = new Map();
  for (const issue of issues) {
    for (const blockerId of issue.blockedBy) {
      if (!byId.has(blockerId)) continue;
      if (!dependentsOf.has(blockerId)) dependentsOf.set(blockerId, []);
      dependentsOf.get(blockerId).push(issue);
    }
  }

  const memo = new Map();
  const visiting = new Set();
  function latestEnd(issue) {
    if (memo.has(issue.id)) return memo.get(issue.id);
    // Cycle de dépendances (déjà signalé ailleurs dans l'app) : ne pas
    // boucler indéfiniment, traiter comme non contraint depuis ce point.
    if (visiting.has(issue.id)) return FAR_FUTURE;
    visiting.add(issue.id);
    let bound = issue.projectTargetDate ?? FAR_FUTURE;
    for (const dep of dependentsOf.get(issue.id) ?? []) {
      if (!dep.start || !dep.end) continue;
      const duration = daysBetween(dep.start, dep.end);
      const depLatestStart = addDays(latestEnd(dep), -duration);
      const bounded = addDays(depLatestStart, -1);
      if (bounded < bound) bound = bounded;
    }
    visiting.delete(issue.id);
    memo.set(issue.id, bound);
    return bound;
  }

  const result = new Map();
  for (const issue of issues) {
    if (issue.start && issue.end) result.set(issue.id, latestEnd(issue));
  }
  return result;
}

function issuesForSlack(domain, teamId) {
  const projectById = new Map(domain.projects.map((p) => [p.id, p]));
  return domain.issues
    .filter((i) => i.start && i.end && i.status !== 'canceled' && i.status !== 'done' && (teamId === null || i.teamId === teamId))
    .map((i) => ({ ...i, projectTargetDate: projectById.get(i.projectId)?.targetDate ?? null }));
}

const overlapsWeek = (days, weekStart) => {
  const weekEnd = addDays(weekStart, 6);
  return days.some((d) => d >= weekStart && d <= weekEnd);
};

// Total d'heures excédentaires, tous·tes contributeur·rices et toutes
// semaines confondus, au-delà du plafond de charge — l'objectif que
// chaque étape de la recherche gloutonne ci-dessous cherche à réduire.
// Une semaine "indisponible" (charge posée sur une capacité nulle) compte
// pour la totalité de ses heures : aucun plafond ne peut l'absorber.
function overloadHours(load, ceiling) {
  let total = 0;
  for (const rows of Object.values(load.people)) {
    for (const w of rows) {
      if (!Number.isFinite(w.pct)) { total += w.hours; continue; }
      const allowed = (w.capacity * ceiling) / 100;
      if (w.hours > allowed) total += w.hours - allowed;
    }
  }
  return total;
}

function workingDaysInWeek(weekStart, holidays) {
  let n = 0;
  for (let k = 0; k < 7; k++) if (isWorkingDay(addDays(weekStart, k), holidays)) n += 1;
  return n;
}

function patchIssue(domain, issueId, patch) {
  return { ...domain, issues: domain.issues.map((i) => (i.id === issueId ? { ...i, ...patch } : i)) };
}

function currentShares(issue, planning) {
  const ids = issue.contributorIds;
  const equal = ids.length ? 100 / ids.length : 0;
  const rows = planning.contributions.filter((c) => c.issueId === issue.id && ids.includes(c.linearUserId));
  const shares = {};
  for (const id of ids) shares[id] = rows.find((r) => r.linearUserId === id)?.share ?? equal;
  return shares;
}

function patchShares(planning, issueId, shares) {
  const contributions = planning.contributions.filter((c) => c.issueId !== issueId)
    .concat(Object.entries(shares).map(([linearUserId, share]) => ({ issueId, linearUserId, share })));
  return { ...planning, contributions };
}

function patchCapacity(planning, userId, weekStart, hours) {
  const weeklyCapacities = planning.weeklyCapacities.filter((c) => !(c.linearUserId === userId && c.weekStart === weekStart))
    .concat([{ linearUserId: userId, weekStart, hours }]);
  return { ...planning, weeklyCapacities };
}

// Poids appliqué au gain mesuré (en heures) de chaque type d'action, pour
// préférer les leviers les moins intrusifs à gain égal : étaler une tâche
// (elle garde son volume, juste plus étalé) coûte moins cher qu'un transfert
// de charge entre personnes, lui-même préférable à décaler une tâche dans le
// temps (retarde son avancement), et tout ça très loin devant l'ajout de
// capacité — qui ne résout rien, ça ne fait que déplacer le plafond.
const PENALTY = { stretch: 0, rebalance: 1, move: 2 };
const MAX_HORIZON_DAYS = 180;

function nonCapacityCandidates(domain, planning, teamId, load, latest, weekStart, userName) {
  const issues = activeIssues(domain, teamId, load, weekStart);
  const out = [];

  for (const issue of issues) {
    const bound = latest.get(issue.id) ?? null;
    // Une marge réelle mais énorme (aucune échéance de projet ni dépendante)
    // est plafonnée à un horizon raisonnable : personne ne veut d'une tâche
    // étalée sur plusieurs siècles, et ça évite de simuler une charge sur
    // une plage de dates absurdement longue à chaque candidat.
    const slack = bound ? Math.min(daysBetween(issue.end, bound), MAX_HORIZON_DAYS) : 0;

    if (slack > 0) {
      // Étaler : repousser seulement l'échéance (le début ne bouge pas), ce
      // qui étale le même volume d'heures sur plus de jours ouvrés et réduit
      // d'autant l'intensité hebdomadaire, sans jamais dépasser la marge
      // réelle de l'issue (chemin critique via latestEndDates).
      for (const frac of [1, 0.66, 0.33]) {
        const extra = Math.max(1, Math.round(slack * frac));
        const newEnd = addDays(issue.end, extra);
        out.push({
          kind: 'stretch',
          summary: `Étaler ${issue.identifier} (${issue.title}) jusqu'au ${newEnd} au lieu du ${issue.end} — même volume, réparti sur plus de jours.`,
          simulate: (d, p) => [patchIssue(d, issue.id, { end: newEnd }), p],
          apply: (api) => api.updateIssue(issue.id, { end: newEnd }),
        });
      }
      // Décaler : repousse tout le bloc (début + fin), à n'utiliser que si
      // étaler ne suffit pas — ça retarde réellement la tâche.
      const wantedShift = daysBetween(issue.start, addDays(weekStart, 7));
      const shift = Math.min(wantedShift, slack);
      if (shift > 0) {
        const newStart = addDays(issue.start, shift);
        const newEnd = addDays(issue.end, shift);
        out.push({
          kind: 'move',
          summary: `Décaler ${issue.identifier} (${issue.title}) du ${newStart} au ${newEnd} (+${shift} j) pour sortir entièrement de la semaine surchargée.`,
          simulate: (d, p) => [patchIssue(d, issue.id, { start: newStart, end: newEnd }), p],
          apply: (api) => api.reschedule(issue.id, { start: newStart, end: newEnd }),
        });
      }
    }

    if (issue.contributorIds.length > 1) {
      const shares = currentShares(issue, planning);
      for (const fromId of issue.contributorIds) {
        for (const toId of issue.contributorIds) {
          if (fromId === toId) continue;
          for (const delta of [10, 20, 30]) {
            if (shares[fromId] - delta <= 0) continue;
            const next = { ...shares, [fromId]: shares[fromId] - delta, [toId]: shares[toId] + delta };
            out.push({
              kind: 'rebalance',
              summary: `Transférer ${delta} points de part de ${userName(fromId)} vers ${userName(toId)} sur ${issue.identifier} (${issue.title}).`,
              userNote: { fromId, toId, issueId: issue.id, issueIdentifier: issue.identifier, delta },
              simulate: (d, p) => [d, patchShares(p, issue.id, next)],
              apply: (api) => api.setContributions(issue.id, Object.entries(next).map(([linearUserId, share]) => ({ linearUserId, share }))),
            });
          }
        }
      }
    }
  }

  return out;
}

// Dernier recours : donner davantage de capacité à une personne précise,
// cette semaine précise seulement — ne réduit la charge de personne d'autre,
// ça ne fait qu'absorber le pic ponctuellement. Toujours mathématiquement
// suffisant à lui seul (dimensionné pour ramener exactement au plafond), donc
// délibérément tenu à l'écart tant qu'une autre action aide encore (voir la
// boucle gloutonne plus bas) : sinon il masquerait des leviers moins lourds.
function capacityCandidates(load, holidays, weekStart, ceiling, userName) {
  const out = [];
  const daysInWeek = workingDaysInWeek(weekStart, holidays);
  if (daysInWeek === 0) return out;
  for (const [userId, rows] of Object.entries(load.people)) {
    const week = rows.find((w) => w.weekStart === weekStart);
    if (!week || week.hours <= 0.01) continue;
    const neededCapacity = (week.hours * 100) / ceiling;
    if (neededCapacity <= week.capacity) continue;
    const neededWeekly = Math.ceil((neededCapacity * 5) / daysInWeek);
    out.push({
      kind: 'capacity',
      summary: `Augmenter la capacité de ${userName(userId)} à ${neededWeekly} h pour la semaine du ${weekStart} (n'allège la charge de personne d'autre).`,
      simulate: (d, p) => [d, patchCapacity(p, userId, weekStart, neededWeekly)],
      apply: (api) => api.setCapacity(userId, weekStart, neededWeekly),
    });
  }
  return out;
}

function activeIssues(domain, teamId, load, weekStart) {
  return domain.issues.filter((i) => i.start && i.end && i.status !== 'canceled' && i.status !== 'done'
    && (teamId === null || i.teamId === teamId) && load.issues[i.id] && overlapsWeek(load.issues[i.id].days, weekStart));
}

function overloadedWeekStarts(load, ceiling) {
  return (load.weeks ?? []).filter((weekStart) => Object.values(load.people)
    .some((rows) => {
      const w = rows.find((r) => r.weekStart === weekStart);
      return w && (!Number.isFinite(w.pct) || w.pct > ceiling);
    }));
}

function bestOf(candidates, base, simDomain, simPlanning, range, teamId, ceiling, penalized) {
  let best = null;
  let bestNet = 0;
  for (const candidate of candidates) {
    const [patchedDomain, patchedPlanning] = candidate.simulate(simDomain, simPlanning);
    const patchedLoad = computeLoad(patchedDomain, patchedPlanning, { range, teamId });
    const gain = base - overloadHours(patchedLoad, ceiling);
    const net = penalized ? gain - PENALTY[candidate.kind] * 0.05 : gain;
    if (net > bestNet + 1e-6) {
      bestNet = net;
      best = { candidate, patchedDomain, patchedPlanning, patchedLoad, gain };
    }
  }
  return best;
}

// Recherche gloutonne : à chaque étape, mesure (par simulation réelle —
// recalcul complet de computeLoad, pas une estimation) l'effet de chaque
// action candidate sur le total d'heures en surcharge. Étaler, décaler et
// rééquilibrer sont toujours essayés en premier (pondérés entre eux par
// PENALTY, du moins au plus intrusif) ; l'ajout de capacité n'est considéré
// que si aucun d'eux n'apporte plus rien ce tour-ci — sinon son gain
// "gratuit" (toujours suffisant par construction) l'emporterait à tort sur
// des leviers qui ne coûtent rien à personne. Chaque choix est ensuite
// appliqué à l'état simulé et le tour recommence, jusqu'à `max`
// recommandations ou jusqu'à ce que plus rien ne réduise la surcharge. Ce
// n'est pas une recherche exhaustive (l'espace des décalages possibles est
// bien trop grand pour ça), mais chaque étape est un choix mesuré sur les
// vraies données plutôt qu'une heuristique non vérifiée.
export function buildRecommendations(domain, planning, load0, ceiling, { teamId = null, range, max = 6 } = {}) {
  const holidays = new Set(planning.holidays.map((h) => h.day));
  const userName = (id) => domain.users.find((u) => u.id === id)?.name ?? id;
  let simDomain = domain;
  let simPlanning = planning;
  let load = load0;
  const overloadBefore = overloadHours(load, ceiling);
  const recommendations = [];
  const usedIssues = new Set();

  for (let step = 0; step < max; step++) {
    const base = overloadHours(load, ceiling);
    if (base <= 0.01) break;
    const issuesWithSlack = issuesForSlack(simDomain, teamId);
    const latest = latestEndDates(issuesWithSlack);
    const weeks = overloadedWeekStarts(load, ceiling);

    const soft = weeks.flatMap((weekStart) => nonCapacityCandidates(simDomain, simPlanning, teamId, load, latest, weekStart, userName)
      .filter((c) => !c.userNote || !usedIssues.has(`${c.kind}:${c.userNote.issueId}:${c.userNote.fromId}`)));
    let best = bestOf(soft, base, simDomain, simPlanning, range, teamId, ceiling, true);
    if (!best) {
      const hard = weeks.flatMap((weekStart) => capacityCandidates(load, holidays, weekStart, ceiling, userName));
      best = bestOf(hard, base, simDomain, simPlanning, range, teamId, ceiling, false);
    }
    if (!best) break;

    if (best.candidate.userNote) usedIssues.add(`${best.candidate.kind}:${best.candidate.userNote.issueId}:${best.candidate.userNote.fromId}`);
    simDomain = best.patchedDomain;
    simPlanning = best.patchedPlanning;
    load = best.patchedLoad;
    recommendations.push({
      id: `r${recommendations.length}`,
      kind: best.candidate.kind,
      summary: best.candidate.summary,
      gainHours: Math.round(best.gain * 10) / 10,
      apply: best.candidate.apply,
    });
  }

  return {
    recommendations,
    overloadBefore: Math.round(overloadBefore * 10) / 10,
    overloadAfter: Math.round(overloadHours(load, ceiling) * 10) / 10,
    stillOverloaded: overloadHours(load, ceiling) > 0.01,
  };
}
