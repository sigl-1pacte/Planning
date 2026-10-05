import { workingDays, mondayOf, addDays, isWorkingDay } from './calendar.js';

export function planningRange(domain) {
  const dates = [];
  for (const i of domain.issues) if (i.start) dates.push(i.start, i.end);
  for (const p of domain.projects) {
    for (const d of [p.startDate, p.targetDate]) if (d) dates.push(d);
    for (const m of p.milestones) if (m.date) dates.push(m.date);
  }
  if (!dates.length) return null;
  dates.sort();
  return { from: mondayOf(dates[0]), to: addDays(mondayOf(dates.at(-1)), 6) };
}

export function defaultWeeklyHours(userId, planning) {
  const person = planning.people.find((p) => p.linearUserId === userId);
  return person?.defaultWeeklyHours ?? planning.settings.defaultWeeklyHours;
}

export function weeklyHours(userId, weekStart, planning) {
  const override = planning.weeklyCapacities.find(
    (c) => c.linearUserId === userId && c.weekStart === weekStart,
  );
  return override ? override.hours : defaultWeeklyHours(userId, planning);
}

export function shareWeights(issue, contributions) {
  const ids = issue.contributorIds;
  if (!ids.length) return {};
  const rows = contributions.filter((c) => c.issueId === issue.id && ids.includes(c.linearUserId));
  const weight = {};
  for (const id of ids) {
    const row = rows.find((r) => r.linearUserId === id);
    weight[id] = rows.length ? (row ? row.share : 100 / ids.length) : 1;
  }
  const total = Object.values(weight).reduce((a, b) => a + b, 0);
  const out = {};
  for (const id of ids) out[id] = total > 0 ? weight[id] / total : 0;
  return out;
}

export function computeLoad(domain, planning, { range, teamId = null }) {
  const holidays = new Set(planning.holidays.map((h) => h.day));
  const hoursPerPoint = planning.settings.hoursPerPoint;
  const issues = {};
  const dayHours = {};
  // Charge réelle : mêmes jours et mêmes parts que le prévu, mais avec les
  // points réellement consommés (realPoints). Sans charge réelle saisie, une
  // tâche compte pour 0.
  const realDayHours = {};

  for (const issue of domain.issues) {
    if (!issue.start || issue.status === 'canceled') continue;
    const days = workingDays(issue.start, issue.end, holidays);
    const hours = (issue.estimate ?? 0) * hoursPerPoint;
    const shares = shareWeights(issue, planning.contributions);
    const counted = teamId === null || issue.teamId === teamId;
    const perPerson = {};
    const realHours = (issue.realPoints ?? 0) * hoursPerPoint;
    for (const [userId, share] of Object.entries(shares)) {
      const personHours = hours * share;
      const perDay = days.length ? personHours / days.length : 0;
      const dailyCapacity = defaultWeeklyHours(userId, planning) / 5;
      perPerson[userId] = {
        hours: personHours,
        ratePct: dailyCapacity > 0 ? Math.round((perDay / dailyCapacity) * 100) : null,
      };
      if (!counted) continue;
      dayHours[userId] ??= {};
      for (const d of days) dayHours[userId][d] = (dayHours[userId][d] ?? 0) + perDay;
      if (realHours > 0 && days.length) {
        const realPerDay = (realHours * share) / days.length;
        realDayHours[userId] ??= {};
        for (const d of days) realDayHours[userId][d] = (realDayHours[userId][d] ?? 0) + realPerDay;
      }
    }
    issues[issue.id] = { hours, days, shares, perPerson };
  }

  const weeks = [];
  for (let w = range.from; w <= range.to; w = addDays(w, 7)) weeks.push(w);

  const people = {};
  for (const user of domain.users) {
    people[user.id] = weeks.map((weekStart) => {
      const weekly = weeklyHours(user.id, weekStart, planning);
      let capacity = 0;
      let hours = 0;
      let realHours = 0;
      for (let k = 0; k < 7; k++) {
        const d = addDays(weekStart, k);
        if (!isWorkingDay(d, holidays)) continue;
        capacity += weekly / 5;
        hours += dayHours[user.id]?.[d] ?? 0;
        realHours += realDayHours[user.id]?.[d] ?? 0;
      }
      const working = hours > 0.01;
      return {
        weekStart,
        hours,
        realHours,
        realPct: capacity > 0 ? (realHours / capacity) * 100 : 0,
        capacity,
        pct: capacity > 0 ? (hours / capacity) * 100 : (working ? Infinity : 0),
        unavailable: capacity === 0 && working,
      };
    });
  }

  return { issues, weeks, people };
}

// Tâches sans aucun contributeur qui auraient déjà dû commencer (début passé,
// ni terminées ni annulées) ou qui commencent dans les `horizonDays` jours :
// personne n'est prévu pour les faire. L'assigné ne compte pas s'il n'est pas
// contributeur (« Contributors: none ») : être responsable n'est pas
// contribuer. Les plus anciennes d'abord ; `started` sépare les deux cas.
export function unstaffedIssues(domain, { today, teamId = null, horizonDays = 7 }) {
  const horizon = addDays(today, horizonDays);
  return domain.issues
    .filter((i) => i.start && i.start <= horizon && !i.contributorIds.length
      && i.status !== 'done' && i.status !== 'canceled'
      && (teamId === null || i.teamId === teamId))
    .sort((a, b) => a.start.localeCompare(b.start) || a.identifier.localeCompare(b.identifier))
    .map((issue) => ({ issue, started: issue.start <= today }));
}

// Tâches planifiées sans personne (ni ligne « Contributors » ni assigné) :
// computeLoad ne les fait peser sur personne. Pour la seule bande de charge,
// leurs heures sont réparties à parts égales entre les membres Linear actifs
// de la team de la tâche, jour ouvré par jour ouvré. Une team sans membre
// connu ne reçoit rien. Renvoie { userId: { lundi: heures } }.
export function unassignedLoad(domain, planning, { teamId = null } = {}) {
  const holidays = new Set(planning.holidays.map((h) => h.day));
  const active = new Set(domain.users.filter((u) => u.active !== false).map((u) => u.id));
  const out = {};
  for (const issue of domain.issues) {
    if (!issue.start || issue.status === 'canceled' || issue.contributorIds.length) continue;
    if (teamId !== null && issue.teamId !== teamId) continue;
    const members = (domain.teams.find((t) => t.id === issue.teamId)?.memberIds ?? []).filter((id) => active.has(id));
    const days = workingDays(issue.start, issue.end, holidays);
    const hours = (issue.estimate ?? 0) * planning.settings.hoursPerPoint;
    if (!members.length || !days.length || hours <= 0) continue;
    const perDay = hours / members.length / days.length;
    for (const id of members) {
      out[id] ??= {};
      for (const d of days) out[id][mondayOf(d)] = (out[id][mondayOf(d)] ?? 0) + perDay;
    }
  }
  return out;
}

// Détail d'une cellule de la bande de charge : les tâches qui font la charge
// de `userId` pendant la semaine qui commence le lundi `weekStart`, avec les
// mêmes calculs que computeLoad (et unassignedLoad pour les tâches sans
// personne, `unassigned: true`). La somme des heures redonne la cellule.
// Plus lourdes d'abord.
export function weekBreakdown(domain, planning, load, { userId, weekStart, teamId = null }) {
  const holidays = new Set(planning.holidays.map((h) => h.day));
  const hoursPerPoint = planning.settings.hoursPerPoint;
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (d) => d >= weekStart && d <= weekEnd;
  const active = new Set(domain.users.filter((u) => u.active !== false).map((u) => u.id));
  const rows = [];
  for (const issue of domain.issues) {
    if (teamId !== null && issue.teamId !== teamId) continue;
    const info = load.issues[issue.id];
    if (info && userId in info.shares) {
      const days = info.days.filter(inWeek);
      if (!days.length) continue;
      const share = info.shares[userId];
      const spread = (total) => (info.days.length ? (total * share * days.length) / info.days.length : 0);
      rows.push({
        issue, days, share, unassigned: false,
        hours: spread(info.hours),
        realHours: spread((issue.realPoints ?? 0) * hoursPerPoint),
      });
      continue;
    }
    if (!issue.start || issue.status === 'canceled' || issue.contributorIds.length) continue;
    const members = (domain.teams.find((t) => t.id === issue.teamId)?.memberIds ?? []).filter((id) => active.has(id));
    if (!members.includes(userId)) continue;
    const allDays = workingDays(issue.start, issue.end, holidays);
    const days = allDays.filter(inWeek);
    const hours = (issue.estimate ?? 0) * hoursPerPoint;
    if (!days.length || hours <= 0) continue;
    rows.push({
      issue, days, share: 1 / members.length, unassigned: true,
      hours: (hours / members.length / allDays.length) * days.length,
      realHours: 0,
    });
  }
  return rows.sort((a, b) => b.hours - a.hours || (a.issue.identifier < b.issue.identifier ? -1 : 1));
}

export function personStats(rows) {
  const active = rows.filter((w) => w.hours > 0.01);
  const finitePct = (w) => (Number.isFinite(w.pct) ? w.pct : 0);
  return {
    total: rows.reduce((s, w) => s + w.hours, 0),
    realTotal: rows.reduce((s, w) => s + (w.realHours ?? 0), 0),
    activeWeeks: active.length,
    peakPct: Math.max(0, ...rows.map((w) => w.pct)),
    avgPct: active.length ? active.reduce((s, w) => s + finitePct(w), 0) / active.length : 0,
  };
}
