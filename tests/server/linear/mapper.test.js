import { describe, it, expect } from 'vitest';
import { mapWorkspace } from '../../../src/server/linear/mapper.js';
import { rawWorkspace } from '../../fixtures/workspace.js';

const find = (d, id) => d.issues.find((i) => i.id === id);

describe('mapWorkspace', () => {
  it('traduit teams, membres, projets et jalons', () => {
    const d = mapWorkspace(rawWorkspace());
    expect(d.teams.map((t) => t.key)).toEqual(['IOT', 'WEB']);
    expect(d.users[0]).toEqual({
      id: 'u-louis', name: 'Louis', displayName: 'louis', email: 'louis@ex.fr', active: true,
      url: 'https://linear.app/1pacte/profiles/louis',
    });
    expect(d.projects[0]).toEqual({
      id: 'p-poc1', name: 'Réalisation POC v1', color: '#0D7278', startDate: '2026-09-16', targetDate: '2026-11-05',
      teamIds: ['t-iot'], milestones: [{ id: 'm-1', name: 'Objet construit', date: '2026-11-05' }],
    });
  });

  it('traduit une issue planifiée complète', () => {
    expect(find(mapWorkspace(rawWorkspace()), 'i-11')).toEqual({
      id: 'i-11', identifier: 'IOT-11', title: 'Conception', teamId: 't-iot', projectId: 'p-poc1', parentId: null,
      estimate: 8, status: 'doing', assigneeId: 'u-sacha', start: '2026-09-16', end: '2026-09-25',
      unplannedReason: null, contributorIds: ['u-sacha', 'u-louis'], contributorsSource: 'description',
      unresolvedMentions: [], blockedBy: [], updatedAt: '2026-09-10T08:00:00.000Z',
      rawDescription: 'Starting date: 16/09/2026\nContributors: @sacha @louis',
    });
  });

  it('traduit le lien vers une issue parente', () => {
    const d = mapWorkspace(rawWorkspace());
    expect(find(d, 'i-12').parentId).toBe('i-11');
    expect(find(d, 'i-11').parentId).toBeNull();
  });

  it('lit les relations de blocage dans les deux sens sans doublon', () => {
    const d = mapWorkspace(rawWorkspace());
    expect(find(d, 'i-12').blockedBy).toEqual(['i-11']);
    expect(find(d, 'i-20').blockedBy).toEqual([]);
  });

  it(`retombe sur l'assigné sans ligne Contributors`, () => {
    const i = find(mapWorkspace(rawWorkspace()), 'i-12');
    expect(i.contributorIds).toEqual(['u-louis']);
    expect(i.contributorsSource).toBe('assignee');
  });

  it('met en non planifiée une issue sans début, sans rien inventer', () => {
    const i = find(mapWorkspace(rawWorkspace()), 'i-13');
    expect(i.start).toBeNull();
    expect(i.end).toBeNull();
    expect(i.unplannedReason).toBe('Aucune ligne « Starting date » dans la description');
    expect(i.contributorsSource).toBe('none');
  });

  it('met en non planifiée une issue sans échéance ou à échéance antérieure', () => {
    const raw = rawWorkspace();
    raw.issues[2].description = 'Starting date: 01/10/2026';
    raw.issues[3].dueDate = '2026-09-18';
    const d = mapWorkspace(raw);
    expect(find(d, 'i-13').unplannedReason).toBe(`Aucune date d'échéance (Due date)`);
    expect(find(d, 'i-20').unplannedReason).toBe('Échéance 2026-09-18 antérieure au début 2026-09-21');
  });

  it('traduit statuts, issue hors projet, estimation absente et échéance datée', () => {
    const raw = rawWorkspace();
    raw.issues[3].dueDate = '2026-09-22T00:00:00.000Z';
    const i = find(mapWorkspace(raw), 'i-20');
    expect(i.status).toBe('done');
    expect(i.projectId).toBeNull();
    expect(i.estimate).toBeNull();
    expect(i.end).toBe('2026-09-22');
  });

  it('ignore une relation vers une issue absente', () => {
    const raw = rawWorkspace();
    raw.issues[1].inverseRelations.nodes.push({ type: 'blocks', issue: { id: 'i-disparue' } });
    expect(find(mapWorkspace(raw), 'i-12').blockedBy).toEqual(['i-11']);
  });

  it(`produit un résultat identique quel que soit l'ordre d'entrée`, () => {
    const a = rawWorkspace();
    const b = rawWorkspace();
    b.issues.reverse();
    b.teams.reverse();
    expect(JSON.stringify(mapWorkspace(a))).toBe(JSON.stringify(mapWorkspace(b)));
  });
});
