const conn = (nodes = []) => ({ nodes });

function issue(over) {
  return {
    description: null, estimate: null, dueDate: null, updatedAt: '2026-09-10T08:00:00.000Z',
    archivedAt: null, state: { type: 'unstarted' }, assignee: null, project: null, parent: null,
    relations: conn(), inverseRelations: conn(), comments: conn(),
    ...over,
  };
}

export function rawWorkspace() {
  return {
    teams: [
      { id: 't-iot', key: 'IOT', name: 'IoT' },
      { id: 't-web', key: 'WEB', name: 'Web' },
    ],
    users: [
      { id: 'u-sacha', name: 'Sacha', displayName: 'sacha', email: 'sacha@ex.fr', active: true },
      { id: 'u-louis', name: 'Louis', displayName: 'louis', email: 'louis@ex.fr', active: true },
    ],
    projects: [
      {
        id: 'p-poc1', name: 'Réalisation POC v1', color: '#0D7278',
        startDate: '2026-09-16', targetDate: '2026-11-05',
        teams: conn([{ id: 't-iot' }]),
        projectMilestones: conn([{ id: 'm-1', name: 'Objet construit', targetDate: '2026-11-05' }]),
      },
    ],
    issues: [
      issue({
        id: 'i-11', identifier: 'IOT-11', title: 'Conception', team: { id: 't-iot' }, project: { id: 'p-poc1' },
        description: 'Starting date: 16/09/2026', dueDate: '2026-09-25', estimate: 8,
        state: { type: 'started' }, assignee: { id: 'u-sacha' },
        relations: conn([{ type: 'blocks', relatedIssue: { id: 'i-12' } }]),
        comments: conn([{ id: 'c-1', body: 'Contributors: @sacha @louis', createdAt: '2026-09-02T09:00:00.000Z' }]),
      }),
      issue({
        id: 'i-12', identifier: 'IOT-12', title: 'Software', team: { id: 't-iot' }, project: { id: 'p-poc1' },
        description: 'Starting date: 28/09/2026', dueDate: '2026-10-09', estimate: 5,
        assignee: { id: 'u-louis' }, parent: { id: 'i-11' },
        inverseRelations: conn([{ type: 'blocks', issue: { id: 'i-11' } }]),
      }),
      issue({
        id: 'i-13', identifier: 'IOT-13', title: 'Sans date', team: { id: 't-iot' }, project: { id: 'p-poc1' },
        description: 'Pas encore planifiée', estimate: 3,
      }),
      issue({
        id: 'i-20', identifier: 'WEB-1', title: 'Hors projet', team: { id: 't-web' },
        description: 'Starting date: 21/09/2026', dueDate: '2026-09-22',
        state: { type: 'completed' },
        relations: conn([{ type: 'related', relatedIssue: { id: 'i-11' } }]),
      }),
    ],
  };
}
