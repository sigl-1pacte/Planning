// tests/ui/unplannedTab.test.js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderUnplannedTab } from '../../src/ui/render/unplannedTab.js';

const issues = [
  { id: 'i1', identifier: 'IOT-13', title: 'Sans date', teamId: 't-iot', estimate: 3, unplannedReason: 'Aucune ligne « Starting date »' },
];
const teams = [{ id: 't-iot', key: 'IOT', name: 'IoT' }];

describe('renderUnplannedTab', () => {
  it('affiche une ligne par tâche avec deux sélecteurs de date', () => {
    const section = document.createElement('section');
    renderUnplannedTab(section, { issues, teams, onPlan: vi.fn() });
    expect(section.querySelector('h2').textContent).toBe('Tâches non planifiées (1)');
    expect(section.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(section.querySelector('[data-start]')).not.toBeNull();
    expect(section.querySelector('[data-end]')).not.toBeNull();
  });

  it('appelle onPlan avec les deux dates saisies', () => {
    const onPlan = vi.fn();
    const section = document.createElement('section');
    renderUnplannedTab(section, { issues, teams, onPlan });
    section.querySelector('[data-start]').value = '2026-10-01';
    section.querySelector('[data-end]').value = '2026-10-05';
    section.querySelector('[data-action="plan"]').click();
    expect(onPlan).toHaveBeenCalledWith('i1', { start: '2026-10-01', end: '2026-10-05' });
  });

  it('affiche un message quand tout est planifié', () => {
    const section = document.createElement('section');
    renderUnplannedTab(section, { issues: [], teams: [], onPlan: vi.fn() });
    expect(section.textContent).toContain('Aucune tâche non planifiée');
  });
});
