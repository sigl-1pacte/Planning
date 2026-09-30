// Aperçu local des écritures vers Linear : l'écran montre une modification dès
// qu'elle est faite, pendant que l'écriture attend son tour dans la file
// (controller.js). Chaque aperçu reprend les calculs de l'écriture elle-même
// (issueUpdateInput, rescheduleInputs…) et relit la tâche avec le mapper du
// serveur : ce qui s'affiche est ce que la synchronisation relira ensuite.
import { mapIssue } from '../server/linear/mapper.js';
import { issueUpdateInput, rescheduleInputs, contributorsInput } from './linearWrites.js';

const stateType = (domain, stateId) => (domain.workflowStates ?? []).find((s) => s.id === stateId)?.type;

// Tâche du domaine → forme brute renvoyée par Linear, modifiée par `input`
// (champs d'IssueUpdateInput), puis relue par mapIssue.
function applyInput(domain, issue, input) {
  const raw = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.rawDescription,
    estimate: issue.estimate,
    dueDate: issue.dueDate,
    updatedAt: issue.updatedAt,
    state: { id: issue.stateId, type: stateType(domain, issue.stateId) },
    assignee: issue.assigneeId ? { id: issue.assigneeId } : null,
    team: { id: issue.teamId },
    project: issue.projectId ? { id: issue.projectId } : null,
    parent: issue.parentId ? { id: issue.parentId } : null,
  };
  if ('title' in input) raw.title = input.title;
  if ('description' in input) raw.description = input.description;
  if ('dueDate' in input) raw.dueDate = input.dueDate;
  if ('estimate' in input) raw.estimate = input.estimate;
  if ('stateId' in input) raw.state = { id: input.stateId, type: stateType(domain, input.stateId) };
  if ('assigneeId' in input) raw.assignee = input.assigneeId ? { id: input.assigneeId } : null;
  if ('teamId' in input) raw.team = { id: input.teamId };
  if ('projectId' in input) raw.project = input.projectId ? { id: input.projectId } : null;
  const next = mapIssue(raw, domain.users, issue.blockedBy);
  // Statut dont le type est inconnu (workflow absent de l'instantané) : on
  // garde l'ancien plutôt que de retomber sur « à faire ».
  if (!raw.state.type) next.status = issue.status;
  return next;
}

function patchIssues(domain, inputs) {
  const byId = new Map(inputs);
  return {
    ...domain,
    issues: domain.issues.map((i) => (byId.has(i.id) ? applyInput(domain, i, byId.get(i.id)) : i)),
  };
}

const mapProjects = (domain, fn) => ({ ...domain, projects: domain.projects.map(fn) });

// Mêmes noms et mêmes arguments que les écritures de linearWrites.js, avec le
// domaine en premier : (domain, ...args) → domaine modifié.
export const previews = {
  updateIssue: (d, id, body) => patchIssues(d, [[id, issueUpdateInput(d, id, body)]]),

  reschedule: (d, id, dates) => patchIssues(d, rescheduleInputs(d, id, dates).map((c) => [c.id, c.input])),

  setContributors: (d, id, contributorIds) => patchIssues(d, [[id, contributorsInput(d, id, contributorIds).input]]),

  setDependencies: (d, id, blockedBy) => {
    const known = new Set(d.issues.map((i) => i.id));
    const next = [...new Set(blockedBy)].filter((b) => known.has(b)).sort();
    return { ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, blockedBy: next } : i)) };
  },

  deleteIssue: (d, id, confirm) => {
    if (d.issues.find((i) => i.id === id)?.identifier !== confirm) return d;
    return {
      ...d,
      issues: d.issues
        .filter((i) => i.id !== id)
        .map((i) => (i.blockedBy.includes(id) ? { ...i, blockedBy: i.blockedBy.filter((b) => b !== id) } : i)),
    };
  },

  updateProject: (d, id, patch) => mapProjects(d, (p) => {
    if (p.id !== id) return p;
    const next = { ...p };
    for (const field of ['name', 'color', 'startDate', 'targetDate']) {
      if (field in patch) next[field] = patch[field] === '' ? null : patch[field];
    }
    return next;
  }),

  deleteProject: (d, id, confirm) => {
    if (d.projects.find((p) => p.id === id)?.name !== confirm) return d;
    return {
      ...d,
      projects: d.projects.filter((p) => p.id !== id),
      issues: d.issues.map((i) => (i.projectId === id ? { ...i, projectId: null } : i)),
    };
  },

  updateMilestone: (d, id, change) => {
    const input = typeof change === 'string' ? { targetDate: change } : change;
    return mapProjects(d, (p) => (p.milestones.some((m) => m.id === id) ? {
      ...p,
      milestones: p.milestones.map((m) => (m.id !== id ? m : {
        ...m,
        ...('name' in input ? { name: input.name } : {}),
        ...('targetDate' in input ? { date: input.targetDate || null } : {}),
      })),
    } : p));
  },
};

// Aperçu d'une écriture donnée sous forme de fonction `(api) => api.x(...)`,
// comme partout dans l'interface : on l'appelle une fois avec un faux `api`
// qui ne fait que noter les méthodes appelées et leurs arguments (sans rien
// envoyer), puis on rejoue ces appels sur le domaine avec `previews`. Seuls
// les appels faits avant le premier `await` sont vus — ce qui couvre les
// écritures d'un seul appel, la forme utilisée partout.
//
// Renvoie null si rien n'est prévisualisable (création, écriture de
// planification) : l'écriture s'affichera à la synchronisation.
export function previewOf(call) {
  const calls = [];
  const recorder = new Proxy({}, {
    get: (_, method) => (typeof method !== 'string' || method === 'then' ? undefined : (...args) => {
      calls.push([method, args]);
      return new Promise(() => {});
    }),
  });
  try {
    Promise.resolve(call(recorder)).catch(() => {});
  } catch {
    return null;
  }
  const steps = calls.filter(([method]) => previews[method]);
  if (!steps.length) return null;
  // Un aperçu qui échoue (ex. cycle de dépendances) ne change rien : c'est
  // l'écriture elle-même qui signalera l'erreur.
  return (domain) => steps.reduce((d, [method, args]) => {
    try {
      return previews[method](d, ...args);
    } catch {
      return d;
    }
  }, domain);
}
