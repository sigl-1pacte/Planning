const KEY_STORAGE = 'planning.linearKey';

// Vide par défaut : le back sert alors les mêmes chemins relatifs /api/...
// que le front (dev via le proxy Vite, prod si les deux sont sur la même
// origine). Renseigné (VITE_API_BASE_URL, injecté au build par Vite) quand
// le back est ailleurs — ex. une Edge Function Supabase, une autre origine
// que le front déployé sur Vercel. Voir README.md.
const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';

export class AuthError extends Error {}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createApi({ fetchImpl = (...args) => fetch(...args), storage = globalThis.localStorage } = {}) {
  const readKey = () => {
    try { return storage.getItem(KEY_STORAGE); } catch { return null; }
  };

  async function request(method, path, body, key = readKey()) {
    const headers = { 'x-linear-key': key ?? '' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) throw new AuthError(data?.error ?? 'Clé Linear refusée');
    if (res.status >= 400) throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status);
    return data;
  }

  const person = (id) => `/api/people/${encodeURIComponent(id)}`;
  const issue = (id) => `/api/issues/${encodeURIComponent(id)}`;
  const project = (id) => `/api/projects/${encodeURIComponent(id)}`;

  return {
    getKey: readKey,
    async saveKey(key) {
      const { user } = await request('POST', '/api/key/validate', undefined, key);
      try { storage.setItem(KEY_STORAGE, key); } catch { /* stockage indisponible : la clé vivra le temps de l'onglet */ }
      return user;
    },
    forgetKey() {
      try { storage.removeItem(KEY_STORAGE); } catch { /* rien à effacer */ }
    },
    snapshot: (since) => request('GET', since == null ? '/api/snapshot' : `/api/snapshot?since=${since}`),
    refresh: () => request('POST', '/api/refresh'),
    planning: () => request('GET', '/api/planning'),
    updateSettings: (settings) => request('PUT', '/api/settings', settings),
    updatePerson: (id, data) => request('PUT', person(id), data),
    setCapacity: (id, week, hours) => request('PUT', `${person(id)}/capacity/${week}`, { hours }),
    clearCapacity: (id, week) => request('DELETE', `${person(id)}/capacity/${week}`),
    setContributions: (issueId, shares) => request('PUT', `${issue(issueId)}/contributions`, { shares }),
    clearContributions: (issueId) => request('DELETE', `${issue(issueId)}/contributions`),
    addHoliday: (day, label) => request('POST', '/api/holidays', { day, label }),
    deleteHoliday: (day) => request('DELETE', `/api/holidays/${day}`),
    updateIssue: (id, patch) => request('PUT', issue(id), patch),
    reschedule: (id, dates) => request('POST', `${issue(id)}/reschedule`, dates),
    setDependencies: (id, blockedBy) => request('PUT', `${issue(id)}/dependencies`, { blockedBy }),
    setContributors: (id, contributorIds) => request('PUT', `${issue(id)}/contributors`, { contributorIds }),
    createIssue: (input) => request('POST', '/api/issues', input),
    // `confirm` : identifiant de la tâche / nom du projet, que le serveur compare à Linear.
    deleteIssue: (id, confirm) => request('DELETE', issue(id), { confirm }),
    updateProject: (id, patch) => request('PUT', project(id), patch),
    createProject: (input) => request('POST', '/api/projects', input),
    deleteProject: (id, confirm) => request('DELETE', project(id), { confirm }),
    createTeam: (input) => request('POST', '/api/teams', input),
    createMilestone: (input) => request('POST', '/api/milestones', input),
    updateMilestone: (id, targetDate) => request('PUT', `/api/milestones/${encodeURIComponent(id)}`, { targetDate }),
  };
}
