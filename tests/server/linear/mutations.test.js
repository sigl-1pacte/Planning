import { describe, it, expect } from 'vitest';
import {
  MUTATIONS, updateIssue, createIssue, issueBlockers, addBlocker, removeBlocker,
  updateProject, createProject, createTeam, addComment,
} from '../../../src/server/linear/mutations.js';
import { fakeFetch, jsonResponse } from '../../helpers/fakeFetch.js';

describe('mutations', () => {
  it('ne contient que des mutations', () => {
    for (const m of MUTATIONS) expect(m).toMatch(/\bmutation\b/i);
  });

  it('met à jour une issue', async () => {
    const f = fakeFetch([jsonResponse({ data: { issueUpdate: { success: true, issue: { id: 'i1', title: 'X' } } } })]);
    const issue = await updateIssue('k', 'i1', { title: 'X' }, { fetchImpl: f });
    expect(issue).toEqual({ id: 'i1', title: 'X' });
    expect(f.calls[0].body.variables).toEqual({ id: 'i1', input: { title: 'X' } });
  });

  it('signale un refus de Linear sans lever d\'exception réseau', async () => {
    const f = fakeFetch([jsonResponse({ data: { issueUpdate: { success: false, issue: null } } })]);
    await expect(updateIssue('k', 'i1', { title: 'X' }, { fetchImpl: f })).rejects.toThrow('Linear a refusé la modification');
  });

  it('crée une issue', async () => {
    const f = fakeFetch([jsonResponse({ data: { issueCreate: { success: true, issue: { id: 'i2', identifier: 'IOT-2' } } } })]);
    const issue = await createIssue('k', { teamId: 't1', title: 'Nouvelle' }, { fetchImpl: f });
    expect(issue.identifier).toBe('IOT-2');
  });

  it('liste les bloqueurs actuels d\'une issue', async () => {
    const f = fakeFetch([jsonResponse({ data: { issue: { inverseRelations: { nodes: [{ id: 'r1', type: 'blocks', issue: { id: 'b1' } }, { id: 'r2', type: 'related', issue: { id: 'x' } }] } } } })]);
    expect(await issueBlockers('k', 'i1', { fetchImpl: f })).toEqual([{ relationId: 'r1', blockerId: 'b1' }]);
  });

  it('ajoute et retire un bloqueur', async () => {
    const add = fakeFetch([jsonResponse({ data: { issueRelationCreate: { success: true } } })]);
    await addBlocker('k', 'i1', 'b1', { fetchImpl: add });
    expect(add.calls[0].body.variables.input).toEqual({ issueId: 'b1', relatedIssueId: 'i1', type: 'blocks' });

    const del = fakeFetch([jsonResponse({ data: { issueRelationDelete: { success: true } } })]);
    await removeBlocker('k', 'r1', { fetchImpl: del });
    expect(del.calls[0].body.variables).toEqual({ id: 'r1' });
  });

  it('met à jour et crée un projet', async () => {
    const f1 = fakeFetch([jsonResponse({ data: { projectUpdate: { success: true, project: { id: 'p1', name: 'Y' } } } })]);
    expect((await updateProject('k', 'p1', { name: 'Y' }, { fetchImpl: f1 })).name).toBe('Y');
    const f2 = fakeFetch([jsonResponse({ data: { projectCreate: { success: true, project: { id: 'p2', name: 'Z' } } } })]);
    expect((await createProject('k', { teamIds: ['t1'], name: 'Z' }, { fetchImpl: f2 })).name).toBe('Z');
  });

  it('crée une team', async () => {
    const f = fakeFetch([jsonResponse({ data: { teamCreate: { success: true, team: { id: 't2', key: 'NEW', name: 'Nouvelle' } } } })]);
    expect((await createTeam('k', { key: 'NEW', name: 'Nouvelle' }, { fetchImpl: f })).key).toBe('NEW');
  });

  it('ajoute un commentaire', async () => {
    const f = fakeFetch([jsonResponse({ data: { commentCreate: { success: true, comment: { id: 'c1' } } } })]);
    await addComment('k', 'i1', 'Contributeurs ajoutés : @sacha', { fetchImpl: f });
    expect(f.calls[0].body.variables.input).toEqual({ issueId: 'i1', body: 'Contributeurs ajoutés : @sacha' });
  });

  it('signale un refus d\'ajout de commentaire', async () => {
    const f = fakeFetch([jsonResponse({ data: { commentCreate: { success: false, comment: null } } })]);
    await expect(addComment('k', 'i1', 'x', { fetchImpl: f })).rejects.toThrow('Linear a refusé l\'ajout du commentaire');
  });
});
