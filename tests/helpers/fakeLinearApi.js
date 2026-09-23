import { rawWorkspace } from '../fixtures/workspace.js';

// Faux Linear qui garde un état : une mutation modifie ce que les requêtes
// suivantes renvoient, comme le vrai. Sert aux tests d'intégration qui
// vérifient tout le trajet écriture → relecture, pas seulement les mocks.
export function fakeLinearApi() {
  const raw = rawWorkspace();
  const log = [];
  let counter = 0;
  const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  const conn = (nodes) => ({ nodes });

  function handle(query, variables) {
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    log.push({ op, variables });
    switch (op) {
      case 'Teams': return { teams: page(raw.teams) };
      case 'Users': return { users: page(raw.users) };
      case 'Projects': return { projects: page(raw.projects) };
      case 'WorkflowStates': return { workflowStates: page(raw.workflowStates) };
      case 'Issues': return { issues: page(raw.issues) };
      case 'Viewer': return { viewer: { id: 'u-sacha', name: 'Sacha', email: 'sacha@ex.fr' } };
      case 'ProjectMilestoneUpdate': {
        const m = raw.projects.flatMap((p) => p.projectMilestones.nodes).find((x) => x.id === variables.id);
        if (!m) return { error: 'Entity not found: ProjectMilestone' };
        Object.assign(m, variables.input);
        return { projectMilestoneUpdate: { success: true, projectMilestone: m } };
      }
      case 'ProjectMilestoneCreate': {
        const project = raw.projects.find((p) => p.id === variables.input.projectId);
        if (!project) return { error: 'Entity not found: Project' };
        counter += 1;
        const m = { id: `m-new-${counter}`, name: variables.input.name, targetDate: variables.input.targetDate ?? null };
        project.projectMilestones = conn([...project.projectMilestones.nodes, m]);
        return { projectMilestoneCreate: { success: true, projectMilestone: m } };
      }
      default: return { error: `opération inconnue : ${op}` };
    }
  }

  const fetchImpl = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const out = handle(query, variables);
    // Copie JSON, comme un vrai aller-retour réseau : sans elle, le cache du
    // serveur partagerait les objets du faux Linear et verrait ses mutations.
    if (out.error) return { status: 200, json: async () => ({ errors: [{ message: out.error }] }) };
    return { status: 200, json: async () => JSON.parse(JSON.stringify({ data: out })) };
  };

  return { raw, log, fetchImpl };
}
