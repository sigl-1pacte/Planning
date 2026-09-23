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

  it('préremplit l\'échéance déjà posée dans Linear (et le début lisible)', () => {
    const section = document.createElement('section');
    const withDue = [{ ...issues[0], dueDate: '2026-10-30', startDate: null }];
    renderUnplannedTab(section, { issues: withDue, teams, onPlan: vi.fn() });
    expect(section.querySelector('[data-end]').value).toBe('2026-10-30');
    expect(section.querySelector('[data-start]').value).toBe('');
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

  it('saisit les dates en jj/mm/aaaa et les transmet en ISO à la planification', () => {
    const section = document.createElement('section');
    const onPlan = vi.fn();
    renderUnplannedTab(section, { issues, teams, onPlan });
    const row = section.querySelector('tr[data-t]');
    const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    const [start, end] = row.querySelectorAll('.dtxt');
    type(start, '01102026');
    type(end, '05102026');
    expect(start.value).toBe('01/10/2026');
    row.querySelector('[data-action="plan"]').click();
    expect(onPlan).toHaveBeenCalledWith(row.dataset.t, { start: '2026-10-01', end: '2026-10-05' });
  });

  it('affiche un message quand tout est planifié', () => {
    const section = document.createElement('section');
    renderUnplannedTab(section, { issues: [], teams: [], onPlan: vi.fn() });
    expect(section.textContent).toContain('Aucune tâche non planifiée');
  });

  it('échappe les textes issus de Linear', () => {
    const section = document.createElement('section');
    const unsafe = [{ ...issues[0], title: '<b>x</b>' }];
    renderUnplannedTab(section, { issues: unsafe, teams, onPlan: vi.fn() });
    expect(section.innerHTML).not.toContain('<b>x</b>');
    expect(section.querySelector('tbody tr').textContent).toContain('<b>x</b>');
  });
});
