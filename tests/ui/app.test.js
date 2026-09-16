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
    expect(root.querySelector('h1').textContent).toBe('1PACTE Planning Dashboard — IoT');
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

  it('propose de résoudre les conflits, limités à la team affichée', () => {
    const raw = rawWorkspace();
    raw.issues[1].description = 'Starting date: 20/09/2026'; // i-12 démarre avant la fin de i-11 (25/09)
    const root = document.createElement('div');
    const state = { snapshot: { version: 1, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null, domain: mapWorkspace(raw) }, planning, error: null };
    const prefs = { zoom: 'all', dayWidth: null, collapsed: new Set(), showCanceled: false };
    renderApp(root, { state, route: { view: 'global', teamKey: null }, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560 });
    const banner = root.querySelector('[data-action="resolve-conflicts"]').closest('.banner');
    expect(banner.textContent).toContain('1 conflit');
    expect(banner.textContent).not.toContain('pour IoT');

    const teamRoot = document.createElement('div');
    renderApp(teamRoot, { state, route: { view: 'team', teamKey: 'IOT' }, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560 });
    expect(teamRoot.querySelector('[data-action="resolve-conflicts"]').closest('.banner').textContent).toContain('pour IoT');

    const webRoot = document.createElement('div');
    renderApp(webRoot, { state, route: { view: 'team', teamKey: 'WEB' }, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560 });
    expect(webRoot.querySelector('[data-action="resolve-conflicts"]')).toBeNull();
  });

  it('n\'affiche pas le bouton de résolution quand un cycle existe', () => {
    const raw = rawWorkspace();
    raw.issues[1].description = 'Starting date: 20/09/2026';
    // i-11 bloque déjà i-12 (fixture) ; on ajoute l'inverse pour former un cycle.
    raw.issues[0].inverseRelations = { nodes: [{ type: 'blocks', issue: { id: 'i-12' } }] };
    const root = document.createElement('div');
    const state = { snapshot: { version: 1, fetchedAt: '2026-09-14T10:00:00.000Z', stale: false, lastError: null, domain: mapWorkspace(raw) }, planning, error: null };
    const prefs = { zoom: 'all', dayWidth: null, collapsed: new Set(), showCanceled: false };
    renderApp(root, { state, route: { view: 'global', teamKey: null }, prefs, selectedIssueId: null, today: '2026-09-17', viewportWidth: 560 });
    expect(root.querySelector('[data-action="resolve-conflicts"]')).toBeNull();
    expect(root.textContent).toContain('Dépendances circulaires');
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
