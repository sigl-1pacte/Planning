// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { kanbanColumns, dropState, renderKanban, CLOSED_SHOWN } from '../../src/ui/render/kanban.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const TODAY = '2026-09-17';
const domain = mapWorkspace(rawWorkspace());
const issue = (id) => domain.issues.find((i) => i.id === id);

function render(over = {}) {
  const section = document.createElement('section');
  renderKanban(section, { domain, teamId: null, showCanceled: false, conflicts: [], selectedIssueId: null, today: TODAY, ...over });
  const column = (key) => section.querySelector(`.kcol[data-col="${key}"]`);
  const ids = (key) => [...column(key).querySelectorAll('.kc')].map((c) => c.dataset.kc);
  return { section, column, ids };
}

describe('colonnes', () => {
  it('une team : ses statuts Linear dans l’ordre, annulés seulement si on les montre', () => {
    expect(kanbanColumns(domain, { teamId: 't-iot', showCanceled: false }).map((c) => c.label)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(kanbanColumns(domain, { teamId: 't-iot', showCanceled: true }).map((c) => c.label)).toEqual(['Todo', 'In Progress', 'Done', 'Canceled']);
  });

  it('vue globale : par type de statut, communs à toutes les teams', () => {
    expect(kanbanColumns(domain, { teamId: null, showCanceled: false }).map((c) => c.label)).toEqual(['À faire', 'En cours', 'Terminé']);
    expect(kanbanColumns(domain, { teamId: null, showCanceled: true }).map((c) => c.key)).toEqual(['todo', 'doing', 'done', 'canceled']);
  });
});

describe('statut au dépôt', () => {
  it('colonne d’une team : ce statut, pour une tâche de cette team seulement', () => {
    expect(dropState(domain, issue('i-12'), 'st-iot-started').id).toBe('st-iot-started');
    expect(dropState(domain, issue('i-20'), 'st-iot-started')).toBeNull();
    expect(dropState(domain, issue('i-12'), 'st-iot-unstarted')).toBeNull();
  });

  it('colonne globale : le statut de ce type dans la team de la tâche, Todo avant Backlog', () => {
    const states = [...domain.workflowStates, { id: 'st-iot-backlog', name: 'Backlog', type: 'backlog', position: 0, teamId: 't-iot' }];
    const d = { ...domain, workflowStates: states };
    expect(dropState(d, issue('i-11'), 'todo').id).toBe('st-iot-unstarted');
    expect(dropState(d, issue('i-12'), 'doing').id).toBe('st-iot-started');
    expect(dropState(d, issue('i-20'), 'doing')).toBeNull();
    expect(dropState(d, issue('i-20'), 'done')).toBeNull();
  });
});

describe('rendu', () => {
  it('range chaque tâche dans sa colonne, échéance la plus proche d’abord', () => {
    const { ids, column } = render();
    expect(ids('todo')).toEqual(['i-12', 'i-13']);
    expect(ids('doing')).toEqual(['i-11']);
    expect(ids('done')).toEqual(['i-20']);
    expect(column('todo').querySelector('.kcol-n').textContent).toBe('2');
    expect(column('todo').querySelector('.kcol-pts').textContent).toBe('8 pts');
  });

  it('une carte : identifiant, team et statut réel en vue globale, projet, dates, contributeurs', () => {
    const card = render().section.querySelector('.kc[data-kc="i-11"]');
    expect(card.dataset.open).toBe('i-11');
    expect(card.querySelector('.kc-id').textContent).toBe('IOT-11');
    expect(card.querySelector('.kc-tk').textContent).toBe('IOT');
    expect(card.querySelector('.kc-st').textContent).toBe('In Progress');
    expect(card.querySelector('.kc-pts').textContent).toBe('8 pts');
    expect(card.querySelector('.kc-pj').textContent).toBe('Réalisation POC v1');
    expect(card.querySelector('.kc-dt').textContent).toBe('16/09 → 25/09');
    expect(card.querySelectorAll('.kc-av')).toHaveLength(2);
    expect(render().section.querySelector('.kc[data-kc="i-13"] .kc-dt').textContent).toBe('Non planifiée');
  });

  it('dans une team, ni team ni statut sur les cartes (la colonne le dit)', () => {
    const { section } = render({ teamId: 't-iot' });
    expect(section.querySelector('.kc-tk')).toBeNull();
    expect(section.querySelector('.kc-st')).toBeNull();
    expect(section.querySelector('.kc[data-kc="i-20"]')).toBeNull();
  });

  it('signale le retard, le conflit de dépendance et la tâche sélectionnée', () => {
    const { section } = render({ today: '2026-09-30', conflicts: [{ issueId: 'i-12', blockerId: 'i-11' }], selectedIssueId: 'i-11' });
    expect(section.querySelector('.kc[data-kc="i-11"] .kc-dt').classList.contains('late')).toBe(true);
    expect(section.querySelector('.kc[data-kc="i-20"] .kc-dt').classList.contains('late')).toBe(false);
    expect(section.querySelector('.kc[data-kc="i-12"]').classList.contains('block')).toBe(true);
    expect(section.querySelector('.kc[data-kc="i-11"]').classList.contains('sel')).toBe(true);
  });

  it('colonne terminée : les plus récentes seulement, le reste à la demande', () => {
    const many = Array.from({ length: CLOSED_SHOWN + 5 }, (_, k) => ({
      ...issue('i-20'), id: `d-${k}`, identifier: `WEB-${100 + k}`, updatedAt: `2026-09-${String(10 + (k % 20)).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const d = { ...domain, issues: [...domain.issues, ...many] };
    const section = document.createElement('section');
    const base = { domain: d, teamId: null, showCanceled: false, conflicts: [], selectedIssueId: null, today: TODAY };
    renderKanban(section, base);
    const done = () => section.querySelector('.kcol[data-col="done"]');
    expect(done().querySelectorAll('.kc')).toHaveLength(CLOSED_SHOWN);
    expect(done().querySelector('.kcol-n').textContent).toBe(String(CLOSED_SHOWN + 6));
    expect(done().querySelector('[data-kb-more]').textContent).toBe('Afficher les 6 plus anciennes');
    renderKanban(section, { ...base, expanded: new Set(['done']) });
    expect(done().querySelectorAll('.kc')).toHaveLength(CLOSED_SHOWN + 6);
    expect(done().querySelector('[data-kb-more]')).toBeNull();
  });

  it('n\'affiche que les tâches retenues par le filtre, comptes compris', () => {
    const { ids, column } = render({ filter: (i) => i.projectId === 'p-poc1' });
    expect(ids('todo')).toEqual(['i-12', 'i-13']);
    expect(ids('done')).toEqual([]);
    expect(column('done').querySelector('.kcol-n').textContent).toBe('0');
  });

  it('une colonne vide le dit', () => {
    const { column } = render({ teamId: 't-web' });
    expect(column('st-web-unstarted').querySelector('.kcol-empty').textContent).toBe('Aucune tâche');
  });
});
