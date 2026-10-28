// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderFilterBar } from '../../src/ui/render/filterBar.js';
import { EMPTY_FILTER } from '../../src/shared/filters.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const domain = mapWorkspace(rawWorkspace());
const MINE = { id: '7', name: 'Software', filter: { ...EMPTY_FILTER, q: 'soft' } };

function render(over = {}) {
  const el = document.createElement('div');
  renderFilterBar(el, {
    domain, teamId: null, filter: EMPTY_FILTER, viewId: null, views: [MINE], viewsError: null, me: 'u-sacha', naming: false, pendingDelete: null, ...over,
  });
  const chips = () => [...el.querySelectorAll('.fb-chip')].map((c) => c.textContent);
  const on = () => el.querySelector('.fb-chip.on')?.textContent;
  return { el, chips, on };
}

describe('barre de filtres', () => {
  it('vues par défaut puis vues de la personne, « Toutes les tâches » choisie sans filtre', () => {
    const { el, chips, on } = render();
    expect(chips()).toEqual(['Toutes les tâches', 'Mes tâches', 'En retard', 'Cette semaine', 'Sans contributeur', 'Software']);
    expect(on()).toBe('Toutes les tâches');
    expect(el.querySelector('[data-view-del="7"]')).not.toBeNull();
    expect(el.querySelector('[data-fb-save], [data-fb-clear], .fb-print')).toBeNull();
  });

  it('reconnaît la vue qui correspond au filtre, et signale une vue modifiée', () => {
    expect(render({ filter: { ...EMPTY_FILTER, due: 'overdue' } }).on()).toBe('En retard');
    const { el, on } = render({ filter: { ...EMPTY_FILTER, q: 'softw' }, viewId: '7' });
    expect(on()).toBe('Software');
    expect(el.querySelector('.fb-chip.on').classList.contains('mod')).toBe(true);
    expect(el.querySelector('[data-fb-update]').textContent).toBe('Mettre à jour « Software »');
  });

  it('propose d\'enregistrer un filtre qui ne correspond à aucune vue, puis demande un nom', () => {
    const filter = { ...EMPTY_FILTER, people: ['u-louis'], projects: ['p-poc1'] };
    const { el } = render({ filter });
    expect(el.querySelector('[data-fb-save]').textContent).toBe('Enregistrer comme vue…');
    expect(el.querySelector('[data-fb-clear]')).not.toBeNull();
    expect(el.querySelector('summary.fb-pick.set').textContent).toContain('Louis');
    expect(el.querySelector('.fb-print').textContent).toBe('Vue filtrée : personne : Louis · projet : Réalisation POC v1.');
    expect(render({ filter, naming: true }).el.querySelector('[data-fb-name]')).not.toBeNull();
  });

  it('choix de personnes : moi d\'abord, puis personne, puis les autres ; projets puis sans projet', () => {
    const { el } = render();
    expect([...el.querySelectorAll('[data-fb-people]')].map((i) => i.value)).toEqual(['me', 'nobody', 'u-louis']);
    expect(el.querySelector('[data-fb-people]').closest('label').textContent).toBe('Moi (Sacha)');
    expect([...el.querySelectorAll('[data-fb-projects]')].map((i) => i.value)).toEqual(['p-poc1', 'none']);
  });

  it('sans identité ni vues personnelles : « Mes tâches » inactive, et pas d\'enregistrement', () => {
    const { el } = render({ me: null, views: null, viewsError: 'Erreur 404', filter: { ...EMPTY_FILTER, q: 'x' } });
    expect(el.querySelector('[data-view="preset:mine"]').disabled).toBe(true);
    expect(el.querySelector('[data-fb-people][value="me"]')).toBeNull();
    expect(el.querySelector('[data-fb-save]')).toBeNull();
    expect(el.querySelector('.fb-note').textContent).toBe('Vues personnelles indisponibles');
  });

  it('dit combien de tâches le filtre retient, ou qu\'aucune ne correspond', () => {
    expect(render({ filter: { ...EMPTY_FILTER, q: 'x' }, matches: 3 }).el.querySelector('.fb-count').textContent).toBe('3 tâches');
    expect(render({ filter: { ...EMPTY_FILTER, q: 'x' }, matches: 0 }).el.querySelector('.fb-count').textContent).toBe('Aucune tâche ne correspond');
    expect(render().el.querySelector('.fb-count')).toBeNull();
  });

  it('demande confirmation avant de supprimer une vue', () => {
    const { el } = render({ pendingDelete: '7' });
    expect(el.querySelector('.fb-own.confirm').textContent).toContain('Supprimer « Software » ?');
    expect(el.querySelector('[data-view-del-ok="7"]')).not.toBeNull();
  });
});
