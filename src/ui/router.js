const TEAM_RE = /^#\/team\/([^/]+?)(?:\/(unplanned|kanban))?$/;
const GLOBAL_TAB_RE = /^#\/(unplanned|kanban)$/;
const ORG_RE = /^#\/org$/;

export function parseRoute(hash) {
  if (ORG_RE.test(hash ?? '')) return { view: 'global', teamKey: null, tab: 'org' };
  const g = GLOBAL_TAB_RE.exec(hash ?? '');
  if (g) return { view: 'global', teamKey: null, tab: g[1] };
  const m = TEAM_RE.exec(hash ?? '');
  if (!m) return { view: 'global', teamKey: null, tab: null };
  try {
    return { view: 'team', teamKey: decodeURIComponent(m[1]), tab: m[2] ?? null };
  } catch {
    return { view: 'global', teamKey: null, tab: null };
  }
}

export function routeHash(route) {
  if (route.tab === 'org') return '#/org';
  const suffix = route.tab === 'unplanned' || route.tab === 'kanban' ? `/${route.tab}` : '';
  if (route.view === 'team') return `#/team/${encodeURIComponent(route.teamKey)}${suffix}`;
  return suffix ? `#${suffix}` : '#/';
}
