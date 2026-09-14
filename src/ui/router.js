const TEAM_RE = /^#\/team\/([^/]+)$/;

export function parseRoute(hash) {
  const m = TEAM_RE.exec(hash ?? '');
  if (!m) return { view: 'global', teamKey: null };
  try {
    return { view: 'team', teamKey: decodeURIComponent(m[1]) };
  } catch {
    return { view: 'global', teamKey: null };
  }
}

export function routeHash(route) {
  return route.view === 'team' ? `#/team/${encodeURIComponent(route.teamKey)}` : '#/';
}
