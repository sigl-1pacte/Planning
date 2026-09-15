// tests/ui/app.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderApp, renderLoadError } from '../../src/ui/app.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const planning = {
  settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
  holidays: [], people: [], weeklyCapacities: [], contributions: [],
};

function draw({ route = { view: 'global', teamKey: null }, snapshotOver = {}, error = null } = {}) {
  const root = document.createElement('div');
  const state = {
    snapshot: { version: 1, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null, domain: mapWorkspace(rawWorkspace()), ...snapshotOver },
    planning,
    error,
  };
  const prefs = { zoom: 'all', dayWidth: null, collapsed: new Set(), showCanceled: false };
  const out = renderApp(root, { state, route, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560 });
  return { root, out };
}

describe('renderApp', () => {
  it('assemble navigation, plateau, charge et tableaux', () => {
    const { root, out } = draw();
    expect([...root.querySelectorAll('.nav a')].map((a) => a.textContent)).toEqual(['Vue globale', 'IOT', 'WEB', 'Non planifiées (1)']);
    expect(root.querySelector('.nav a.on').textContent).toBe('Vue globale');
    expect(root.querySelectorAll('[data-left] .r.tk')).toHaveLength(3);
    expect(root.querySelectorAll('[data-left] .r.ld')).toHaveLength(2);
    expect(out.axis.dayWidth).toBe(10);
    expect(root.querySelector('.canvas').style.width).toBe('560px');
    expect(root.querySelector('[data-grid] .td')).not.toBeNull();
    expect(root.querySelector('.unp').innerHTML).toBe('');
    expect(root.querySelector('[data-zoom="all"]').classList.contains('on')).toBe(true);
  });

  it('bascule sur l’onglet des tâches non planifiées', () => {
    const onPlan = () => {};
    const root = document.createElement('div');
    const state = {
      snapshot: { version: 1, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null, domain: mapWorkspace(rawWorkspace()) },
      planning,
      error: null,
    };
    const prefs = { zoom: 'all', dayWidth: null, collapsed: new Set(), showCanceled: false };
    const route = { view: 'global', teamKey: null, tab: 'unplanned' };
    renderApp(root, { state, route, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560, onPlan });
    expect(root.querySelector('.nav a[href="#/unplanned"]').classList.contains('on')).toBe(true);
    expect(root.querySelector('.board').hidden).toBe(true);
    expect(root.querySelector('.cols').hidden).toBe(true);
    expect(root.querySelector('.unp').hidden).toBe(false);
    expect(root.querySelector('.unp h2').textContent).toBe('Tâches non planifiées (1)');
  });

  it('restreint la page à une team', () => {
    const { root } = draw({ route: { view: 'team', teamKey: 'IOT' } });
    expect(root.querySelector('.nav a.on').textContent).toBe('IOT');
    expect(root.querySelector('h1').textContent).toBe('Planning — IoT');
    expect(root.querySelector('.r.band').textContent).toContain('de la team');
  });

  it('affiche les bandeaux d’état', () => {
    const stale = draw({ snapshotOver: { stale: true, lastError: 'Linear a répondu 503' }, error: 'Linear injoignable' }).root;
    const texts = [...stale.querySelectorAll('.banner')].map((b) => b.textContent);
    expect(texts[0]).toContain('Linear a répondu 503');
    expect(texts[1]).toBe('Linear injoignable');
    const missing = draw({ route: { view: 'team', teamKey: 'NOPE' } }).root;
    expect(missing.querySelector('.banner.err').textContent).toBe('Team « NOPE » introuvable dans le workspace.');
  });
});

describe('renderLoadError', () => {
  it('affiche l’erreur échappée et l’annonce de nouvelle tentative', () => {
    const root = document.createElement('div');
    renderLoadError(root, '<b>x</b>');
    expect(root.querySelector('.banner.err').textContent).toBe('<b>x</b>');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.note').textContent).toBe('Nouvelle tentative automatique toutes les 30 secondes.');
  });
});
