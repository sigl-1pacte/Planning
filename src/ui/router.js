const TEAM_RE = /^#\/team\/([^/]+?)(\/unplanned)?$/;
const GLOBAL_UNPLANNED_RE = /^#\/unplanned$/;

export function parseRoute(hash) {
  if (GLOBAL_UNPLANNED_RE.test(hash ?? '')) return { view: 'global', teamKey: null, tab: 'unplanned' };
  const m = TEAM_RE.exec(hash ?? '');
  if (!m) return { view: 'global', teamKey: null, tab: null };
  try {
    return { view: 'team', teamKey: decodeURIComponent(m[1]), tab: m[2] ? 'unplanned' : null };
  } catch {
    return { view: 'global', teamKey: null, tab: null };
  }
}

export function routeHash(route) {
  const suffix = route.tab === 'unplanned' ? '/unplanned' : '';
  if (route.view === 'team') return `#/team/${encodeURIComponent(route.teamKey)}${suffix}`;
  return route.tab === 'unplanned' ? '#/unplanned' : '#/';
}
