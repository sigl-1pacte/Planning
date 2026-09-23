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
