const TEAM_RE = /^#\/team\/([^/]+)$/;

export function parseRoute(hash) {
  const m = TEAM_RE.exec(hash ?? '');
  return m ? { view: 'team', teamKey: decodeURIComponent(m[1]) } : { view: 'global', teamKey: null };
}

export function routeHash(route) {
  return route.view === 'team' ? `#/team/${encodeURIComponent(route.teamKey)}` : '#/';
}
