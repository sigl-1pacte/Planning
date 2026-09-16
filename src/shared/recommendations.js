import { addDays, daysBetween } from './calendar.js';

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

// Semaines en surcharge (pct > ceiling) sur le périmètre donné, agrégées
// tous contributeurs confondus — mêmes totaux que le graphique de charge.
function overloadedWeeks(load, people, ceiling) {
  if (!people.length) return [];
  const weekStarts = load.people[people[0].id].map((w) => w.weekStart);
  return weekStarts.map((weekStart, i) => {
    let hours = 0;
    let capacity = 0;
    for (const p of people) {
      const w = load.people[p.id][i];
      hours += w.hours;
      capacity += w.capacity;
    }
    const pct = capacity > 0 ? (hours / capacity) * 100 : (hours > 0.01 ? Infinity : 0);
    return { weekStart, pct };
  }).filter((w) => w.pct > ceiling);
}

const overlapsWeek = (days, weekStart) => {
  const weekEnd = addDays(weekStart, 6);
  return days.some((d) => d >= weekStart && d <= weekEnd);
};

// Propose de décaler, pour chaque semaine en surcharge (la pire d'abord),
// l'issue active cette semaine-là qui a le plus de marge avant sa propre
// échéance (ou celle de son projet, ou celle qu'impose une dépendante) —
// jamais au-delà de cette marge, donc jamais au prix d'un retard réel.
export function suggestReschedules(domain, load, ceiling, { teamId = null, max = 5 } = {}) {
  const issues = issuesForSlack(domain, teamId);
  const latest = latestEndDates(issues);
  const weeks = overloadedWeeks(load, domain.users.filter((u) => load.people[u.id]), ceiling)
    .sort((a, b) => b.pct - a.pct);

  const suggestions = [];
  const alreadySuggested = new Set();
  for (const week of weeks) {
    if (suggestions.length >= max) break;
    let best = null;
    let bestSlack = 0;
    for (const issue of issues) {
      if (alreadySuggested.has(issue.id)) continue;
      const info = load.issues[issue.id];
      if (!info || !overlapsWeek(info.days, week.weekStart)) continue;
      const issueLatestEnd = latest.get(issue.id);
      if (!issueLatestEnd) continue;
      const slack = daysBetween(issue.end, issueLatestEnd);
      if (slack > bestSlack) { bestSlack = slack; best = issue; }
    }
    if (!best) continue;
    // Décaler juste assez pour sortir entièrement de la semaine en
    // surcharge (jusqu'au lundi suivant), sans dépasser la marge disponible.
    const wantedShift = daysBetween(best.start, addDays(week.weekStart, 7));
    const shift = Math.min(wantedShift, bestSlack);
    if (shift <= 0) continue;
    alreadySuggested.add(best.id);
    suggestions.push({
      issueId: best.id,
      identifier: best.identifier,
      title: best.title,
      weekStart: week.weekStart,
      currentStart: best.start,
      currentEnd: best.end,
      suggestedStart: addDays(best.start, shift),
      suggestedEnd: addDays(best.end, shift),
      slackDays: bestSlack,
    });
  }
  return suggestions;
}

// Propose, pour chaque personne en surcharge une semaine donnée, de
// transférer une part de charge vers un·e co-contributeur·rice de la même
// tâche qui a de la marge cette semaine-là — ne change aucune date, ne
// touche jamais à une tâche à contributeur unique.
export function suggestContributorSwaps(domain, load, ceiling, { teamId = null, max = 5 } = {}) {
  const issues = domain.issues.filter((i) => i.start && i.end && i.status !== 'canceled' && i.status !== 'done'
    && (teamId === null || i.teamId === teamId) && i.contributorIds.length > 1);
  const userName = (id) => domain.users.find((u) => u.id === id)?.name ?? id;
  const weekStarts = domain.users.length && load.people[domain.users[0].id]
    ? load.people[domain.users[0].id].map((w) => w.weekStart) : [];

  const suggestions = [];
  const overloadedPeople = new Set();
  for (let i = 0; i < weekStarts.length && suggestions.length < max; i += 1) {
    const weekStart = weekStarts[i];
    for (const userId of domain.users.map((u) => u.id)) {
      const week = load.people[userId]?.[i];
      if (!week || week.pct <= ceiling) continue;
      const key = `${userId}|${weekStart}`;
      if (overloadedPeople.has(key)) continue;
      // Tâches de cette personne actives cette semaine-là, avec un·e
      // co-contributeur·rice qui a nettement de la marge la même semaine.
      let best = null;
      for (const issue of issues) {
        if (!issue.contributorIds.includes(userId)) continue;
        const info = load.issues[issue.id];
        if (!info || !overlapsWeek(info.days, weekStart)) continue;
        for (const otherId of issue.contributorIds) {
          if (otherId === userId) continue;
          const otherWeek = load.people[otherId]?.[i];
          if (!otherWeek || otherWeek.pct > ceiling * 0.7) continue;
          const headroom = ceiling * 0.7 - otherWeek.pct;
          if (!best || headroom > best.headroom) best = { issue, otherId, headroom };
        }
      }
      if (best) {
        overloadedPeople.add(key);
        suggestions.push({
          issueId: best.issue.id,
          identifier: best.issue.identifier,
          title: best.issue.title,
          weekStart,
          fromUserId: userId,
          fromName: userName(userId),
          toUserId: best.otherId,
          toName: userName(best.otherId),
        });
        if (suggestions.length >= max) break;
      }
    }
  }
  return suggestions;
}
