import { describe, it, expect } from 'vitest';
import { previews, previewOf } from '../../src/ui/optimistic.js';
import { issueUpdateInput, rescheduleInputs, contributorsInput } from '../../src/ui/linearWrites.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const domain = mapWorkspace(rawWorkspace());
const issueOf = (d, id) => d.issues.find((i) => i.id === id);

// Ce que Linear renverrait après avoir reçu ces IssueUpdateInput, relu par le
// mapper du serveur : l'aperçu doit y être identique, sans quoi le contrôleur
// ne reconnaîtrait jamais l'écriture comme relue.
function linearAfter(inputs) {
  const raw = rawWorkspace();
  for (const [id, input] of inputs) {
    const issue = raw.issues.find((i) => i.id === id);
    if ('title' in input) issue.title = input.title;
    if ('description' in input) issue.description = input.description;
    if ('dueDate' in input) issue.dueDate = input.dueDate;
    if ('estimate' in input) issue.estimate = input.estimate;
    if ('stateId' in input) issue.state = { id: input.stateId, type: raw.workflowStates.find((s) => s.id === input.stateId).type };
    if ('assigneeId' in input) issue.assignee = input.assigneeId ? { id: input.assigneeId } : null;
  }
  return mapWorkspace(raw);
}

describe('aperçu local des écritures', () => {
  it.each([
    [{ title: 'Nouveau titre' }],
    [{ start: '2026-09-18', end: '2026-09-27' }],
    [{ stateId: 'st-iot-completed' }],
    [{ assigneeId: 'u-louis' }],
    [{ estimate: 13 }],
    [{ realPoints: 5 }],
    [{ description: 'Texte libre' }],
  ])('modifier une tâche (%o) : l\'aperçu est ce que Linear relira', (body) => {
    const after = previews.updateIssue(domain, 'i-11', body);
    expect(after).toEqual(linearAfter([['i-11', issueUpdateInput(domain, 'i-11', body)]]));
  });

  it('replanifier : la tâche et ses dépendantes bougent, comme dans Linear', () => {
    const dates = { start: '2026-09-18', end: '2026-09-29' };
    const after = previews.reschedule(domain, 'i-11', dates);
    expect(issueOf(after, 'i-11')).toMatchObject({ start: '2026-09-18', end: '2026-09-29' });
    expect(issueOf(after, 'i-12').start).not.toBe(issueOf(domain, 'i-12').start);
    expect(after).toEqual(linearAfter(rescheduleInputs(domain, 'i-11', dates).map((c) => [c.id, c.input])));
  });

  it('rejouer une modification déjà relue ne change rien (c\'est ainsi qu\'elle est reconnue)', () => {
    const edited = previews.updateIssue(domain, 'i-11', { title: 'X', start: '2026-09-18' });
    expect(JSON.stringify(previews.updateIssue(edited, 'i-11', { title: 'X', start: '2026-09-18' }))).toBe(JSON.stringify(edited));
    const moved = previews.reschedule(domain, 'i-11', { start: '2026-09-18', end: '2026-09-29' });
    expect(JSON.stringify(previews.reschedule(moved, 'i-11', { start: '2026-09-18', end: '2026-09-29' }))).toBe(JSON.stringify(moved));
  });

  it('contributeurs, dépendances', () => {
    const contributors = previews.setContributors(domain, 'i-11', ['u-louis']);
    expect(issueOf(contributors, 'i-11')).toMatchObject({ contributorIds: ['u-louis'], contributorsSource: 'description' });
    const deps = previews.setDependencies(domain, 'i-12', ['i-13', 'i-13', 'inconnue']);
    expect(issueOf(deps, 'i-12').blockedBy).toEqual(['i-13']);
  });

  it('retirer le dernier contributeur : personne, sans retomber sur l\'assigné', () => {
    for (const id of ['i-11', 'i-12']) {
      const after = previews.setContributors(domain, id, []);
      expect(issueOf(after, id)).toMatchObject({ contributorIds: [], contributorsSource: 'nobody' });
      expect(after).toEqual(linearAfter([[id, contributorsInput(domain, id, []).input]]));
    }
  });

  it('supprimer : seulement avec la bonne confirmation, et la tâche disparaît des bloqueuses', () => {
    expect(previews.deleteIssue(domain, 'i-11', 'IOT-12')).toBe(domain);
    const after = previews.deleteIssue(domain, 'i-11', 'IOT-11');
    expect(issueOf(after, 'i-11')).toBeUndefined();
    expect(issueOf(after, 'i-12').blockedBy).toEqual([]);
    expect(previews.deleteProject(domain, 'p-poc1', 'Réalisation POC v1').issues.every((i) => i.projectId === null)).toBe(true);
  });

  it('projets et jalons', () => {
    const project = previews.updateProject(domain, 'p-poc1', { name: 'Renommé', startDate: '' }).projects[0];
    expect(project).toMatchObject({ name: 'Renommé', startDate: null, targetDate: '2026-11-05' });
    const moved = previews.updateMilestone(domain, 'm-1', '2026-11-12').projects[0].milestones[0];
    expect(moved).toEqual({ id: 'm-1', name: 'Objet construit', date: '2026-11-12' });
    const renamed = previews.updateMilestone(domain, 'm-1', { name: 'Nouveau' }).projects[0].milestones[0];
    expect(renamed).toEqual({ id: 'm-1', name: 'Nouveau', date: '2026-11-05' });
  });
});

describe('previewOf', () => {
  it('reconnaît l\'écriture décrite par `(api) => api.x(...)` sans rien envoyer', () => {
    const preview = previewOf((api) => api.updateIssue('i-11', { title: 'Vu' }));
    expect(issueOf(preview(domain), 'i-11').title).toBe('Vu');
  });

  it('rien à prévisualiser pour une création ou une écriture de planification', () => {
    expect(previewOf((api) => api.createIssue({ teamId: 't-iot', title: 'X' }))).toBeNull();
    expect(previewOf((api) => api.setCapacity('u-sacha', '2026-09-21', 0))).toBeNull();
  });

  it('un aperçu impossible (cycle, tâche inconnue) laisse le domaine tel quel : l\'écriture tranchera', () => {
    const preview = previewOf((api) => api.reschedule('inconnue', { start: '2026-09-18', end: '2026-09-20' }));
    expect(preview(domain)).toBe(domain);
  });
});
