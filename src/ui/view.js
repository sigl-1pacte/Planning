import { dependencyConflicts, findCycles } from '../shared/dependencies.js';
import { planningRange } from '../shared/load.js';
import { addDays, mondayOf } from '../shared/calendar.js';

// `filter` : prédicat de filters.js (null sans filtre). Il ne retire que des
// tâches : la charge (people) reste calculée sur tout le périmètre, pour ne
// jamais faire paraître quelqu'un moins chargé qu'il ne l'est.
export function buildView(domain, { route, showCanceled, filter = null }) {
  const team = route.view === 'team' ? domain.teams.find((t) => t.key === route.teamKey) ?? null : null;
  const teams = route.view === 'team' ? (team ? [team] : []) : domain.teams;
  const teamIds = new Set(teams.map((t) => t.id));
  const visible = (i) => showCanceled || i.status !== 'canceled';
  const shown = (i) => visible(i) && (!filter || filter(i));

  const groups = teams.map((t) => {
    const planned = domain.issues.filter((i) => i.teamId === t.id && i.start && shown(i));
    const projects = domain.projects
      .filter((p) => p.teamIds.includes(t.id))
      .map((project) => ({ project, issues: planned.filter((i) => i.projectId === project.id) }))
      // Filtrée, une frise ne garde que les projets qui ont encore des tâches.
      .filter((p) => !filter || p.issues.length);
    const listed = new Set(domain.projects.filter((p) => p.teamIds.includes(t.id)).map((p) => p.id));
    const noProject = planned.filter((i) => !listed.has(i.projectId));
    return { team: t, projects, noProject };
  });

  const scoped = domain.issues.filter((i) => teamIds.has(i.teamId));
  const contributorIds = new Set(
    scoped.filter((i) => i.start && i.status !== 'canceled').flatMap((i) => i.contributorIds),
  );

  return {
    notFound: route.view === 'team' && !team,
    teamId: team?.id ?? null,
    groups,
    unplanned: scoped.filter((i) => !i.start && shown(i)),
    people: domain.users
      .filter((u) => contributorIds.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    conflicts: dependencyConflicts(domain.issues),
    cycles: findCycles(domain.issues),
  };
}

export function rangeFor(domain, view, todayIso) {
  const issues = view.groups.flatMap((g) => [...g.projects.flatMap((p) => p.issues), ...g.noProject]);
  const projects = [...new Map(
    view.groups.flatMap((g) => g.projects.map((p) => [p.project.id, p.project])),
  ).values()];
  const range = planningRange({ ...domain, issues, projects });
  if (range) return range;
  const from = mondayOf(todayIso);
  return { from, to: addDays(from, 27) };
}
