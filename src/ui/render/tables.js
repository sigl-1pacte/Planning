import { personStats } from '../../shared/load.js';
import { STATUS, esc, initials, personColor, fr1, shortDay } from './format.js';

const plannedOf = (view) => view.groups.flatMap((g) => [...g.projects.flatMap((p) => p.issues), ...g.noProject]);
const pctText = (pct) => (Number.isFinite(pct) ? `${Math.round(pct)} %` : '∞');

export function summarize({ view, load, planning }) {
  const planned = plannedOf(view);
  const scope = [...planned, ...view.unplanned];
  const inScope = new Set(scope.map((i) => i.id));
  const ceiling = planning.settings.loadCeilingPct;
  const weeks = view.people.flatMap((u) => load.people[u.id]);
  return {
    teams: view.groups.length,
    projects: new Set(view.groups.flatMap((g) => g.projects.map((p) => p.project.id))).size,
    issues: scope.length,
    points: scope.reduce((s, i) => s + (i.estimate ?? 0), 0),
    hours: planned.reduce((s, i) => s + (load.issues[i.id]?.hours ?? 0), 0),
    peak: Math.max(0, ...weeks.map((w) => w.pct)),
    overWeeks: weeks.filter((w) => w.pct > ceiling).length,
    conflicts: view.conflicts.filter((c) => inScope.has(c.issueId)).length,
    unplanned: view.unplanned.length,
    cycles: view.cycles.length,
    ceiling,
  };
}

export function renderFacts(el, s) {
  const facts = [
    ...(s.teams > 1 ? [['Teams', s.teams, false]] : []),
    ['Projets', s.projects, false],
    ['Tâches', s.issues, false],
    ['Points', s.points, false],
    ['Heures', Math.round(s.hours), false],
    ['Pic de charge', pctText(s.peak), s.peak > s.ceiling],
    ['Semaines hors plafond', s.overWeeks, s.overWeeks > 0],
    ['Liens en conflit', s.conflicts, s.conflicts > 0],
    ['Non planifiées', s.unplanned, s.unplanned > 0],
  ];
  el.innerHTML = facts
    .map(([label, value, alert]) => `<div class="fact"><div class="v${alert ? ' al' : ''}">${esc(value)}</div><div class="l">${label}</div></div>`)
    .join('');
}

// Ligne de total du tableau : les colonnes additives (points, heures) sont
// sommées ; les autres se calculent sur l'ensemble, pas en additionnant des
// colonnes qui n'ont pas de sens ainsi — les semaines actives sont les semaines
// distinctes où au moins une personne travaille (pas la somme par personne),
// le taux moyen est celui de toutes les semaines-personne actives, le pic le
// plus haut de tous.
function totalRow({ people, load, points }) {
  const all = people.flatMap((u) => load.people[u.id]);
  const stats = personStats(all);
  const activeWeeks = new Set(all.filter((w) => w.hours > 0.01).map((w) => w.weekStart)).size;
  return { points, hours: stats.total, activeWeeks, perWeek: activeWeeks ? stats.total / activeWeeks : 0, avgPct: stats.avgPct, peakPct: stats.peakPct };
}

export function renderPeopleTable(tbody, { view, load, planning, domain }) {
  const ceiling = planning.settings.loadCeilingPct;
  const counted = plannedOf(view);
  let totalPoints = 0;
  const rows = view.people.map((user) => {
    const stats = personStats(load.people[user.id]);
    const points = counted.reduce((s, issue) => s + (issue.estimate ?? 0) * (load.issues[issue.id]?.shares[user.id] ?? 0), 0);
    totalPoints += points;
    const hot = stats.peakPct > ceiling;
    return `<tr>
      <td><span class="ini" style="background-color:${personColor(user.id, domain.users)};display:inline-block;margin-right:8px">${esc(initials(user))}</span>${esc(user.name)}</td>
      <td class="r">${fr1(points)}</td>
      <td class="r">${Math.round(stats.total)} h${stats.realTotal > 0.01 ? `<br><span class="rl-txt">réel ${Math.round(stats.realTotal)} h</span>` : ''}</td>
      <td class="r">${stats.activeWeeks}</td>
      <td class="r">${fr1(stats.activeWeeks ? stats.total / stats.activeWeeks : 0)} h</td>
      <td class="r">${Math.round(stats.avgPct)} %</td>
      <td class="r" style="color:${hot ? '#B9700A' : 'inherit'};font-weight:${hot ? 600 : 400}">${pctText(stats.peakPct)}</td>
    </tr>`;
  });
  // Un total n'apporte rien avec une seule personne : il ne redirait que sa ligne.
  if (rows.length > 1) {
    const t = totalRow({ people: view.people, load, points: totalPoints });
    const hot = t.peakPct > ceiling;
    rows.push(`<tr class="tot">
      <td>Total</td>
      <td class="r">${fr1(t.points)}</td>
      <td class="r">${Math.round(t.hours)} h</td>
      <td class="r">${t.activeWeeks}</td>
      <td class="r">${fr1(t.perWeek)} h</td>
      <td class="r">${Math.round(t.avgPct)} %</td>
      <td class="r" style="color:${hot ? '#B9700A' : 'inherit'}">${pctText(t.peakPct)}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('') || '<tr><td colspan="7">Personne n\'a de charge dans cette vue.</td></tr>';
}

export function renderProjectsTable(tbody, { view, load }) {
  const rows = [];
  for (const group of view.groups) {
    for (const { project, issues } of group.projects) {
      const points = issues.reduce((s, i) => s + (i.estimate ?? 0), 0);
      const done = issues.filter((i) => i.status === 'done').reduce((s, i) => s + (i.estimate ?? 0), 0);
      const hours = issues.reduce((s, i) => s + (load.issues[i.id]?.hours ?? 0), 0);
      const period = project.startDate && project.targetDate
        ? `${shortDay(project.startDate)} → ${shortDay(project.targetDate)}`
        : '—';
      const milestones = project.milestones
        .filter((m) => m.date)
        .map((m) => `${esc(m.name)} · ${shortDay(m.date)}`)
        .join('<br>') || '—';
      const teamTag = view.teamId ? '' : ` <span style="color:var(--ink3)">${esc(group.team.key)}</span>`;
      rows.push(`<tr>
        <td><span class="sw" style="background:${esc(project.color)};display:inline-block;margin-right:8px"></span>${esc(project.name)}${teamTag}</td>
        <td>${period}</td>
        <td class="r">${issues.length}</td>
        <td class="r">${points}</td>
        <td class="r">${Math.round(hours)} h</td>
        <td class="r">${points ? Math.round((done / points) * 100) : 0} %</td>
        <td>${milestones}</td>
      </tr>`);
    }
  }
  tbody.innerHTML = rows.join('') || '<tr><td colspan="7">Aucun projet dans cette vue.</td></tr>';
}

export function renderLegend(el, { view, planning }) {
  const projects = [...new Map(
    view.groups.flatMap((g) => g.projects.map((p) => [p.project.id, p.project])),
  ).values()];
  const ceiling = planning.settings.loadCeilingPct;
  el.innerHTML = [
    ...projects.map((p) => `<span><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>`),
    '<span><i style="background:#6A6F76;background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.55) 0 3px,transparent 3px 6px)"></i>En cours</span>',
    '<span><i style="background:#6A6F76;opacity:.34"></i>Terminé</span>',
    `<span><i style="background:${STATUS.blocked.color}"></i>Bloqué (conflit de dépendance)</span>`,
    '<span><i style="background:var(--off)"></i>Jour non ouvré</span>',
    '<span><i style="background:#DEECE4;border:1px solid rgba(16,29,40,.15)"></i>charge légère</span>',
    '<span><i style="background:#9CC9B2;border:1px solid rgba(16,29,40,.15)"></i>rythme normal</span>',
    `<span><i style="background:#E5B274;border:1px solid rgba(16,29,40,.15)"></i>au-dessus de ${ceiling} %</span>`,
    '<span><i style="background:#B23A3A"></i>surcharge</span>',
    '<span><i style="background:#fff;box-shadow:inset 0 -3px 0 #101D28;border:1px solid rgba(16,29,40,.15)"></i>capacité ajustée</span>',
    '<span><i style="background:#DEECE4;box-shadow:inset 0 -3px 0 rgba(16,29,40,.72);border:1px solid rgba(16,29,40,.15)"></i>filet : charge réelle</span>',
  ].join('');
}
