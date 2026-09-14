// src/ui/main.js
import './styles.css';
import { createApi } from './api.js';
import { createController } from './controller.js';
import { renderKeyScreen } from './keyScreen.js';
import { createPanels } from './panels.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { parseRoute } from './router.js';
import { renderApp, renderLoadError } from './app.js';
import { scrollLeftForToday } from './render/layout.js';
import { todayISO } from '../shared/calendar.js';

const api = createApi();
const root = document.getElementById('app');
const overlay = document.getElementById('key-overlay');
let prefs = loadPrefs();
let recenter = true;
let printOverride = null;

if (!location.hash && prefs.lastRoute !== '#/') location.hash = prefs.lastRoute;

const showKey = (reason) => renderKeyScreen(overlay, { api, reason, onValidated: () => controller.start() });

const controller = createController({ api, render: draw, showKeyScreen: showKey });

const panels = createPanels({
  drawer: document.getElementById('drw'),
  title: document.getElementById('dwT'),
  body: document.getElementById('dwB'),
  closeButton: document.getElementById('dwX'),
  onMutate: (call) => controller.mutate(call),
  onPrefs: (patch) => setPrefs(patch),
  onForgetKey: () => {
    api.forgetKey();
    controller.stop();
    panels.close();
    showKey(null);
  },
});

function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  savePrefs(prefs);
  draw();
}

function draw() {
  const { state } = controller;
  if (!state.snapshot || !state.planning) {
    if (state.error) renderLoadError(root, state.error);
    return;
  }
  const previousScroll = root.querySelector('.pr')?.scrollLeft ?? 0;
  const today = todayISO();
  const viewportWidth = root.querySelector('.pr')?.clientWidth || Math.max(300, Math.min(window.innerWidth, 1540) - 676);
  const effective = printOverride ? { ...prefs, ...printOverride } : prefs;
  const result = renderApp(root, {
    state,
    route: parseRoute(location.hash),
    prefs: { ...effective, collapsed: new Set(effective.collapsed) },
    selectedIssueId: panels.selectedIssueId(),
    today,
    viewportWidth,
  });
  const pane = root.querySelector('.pr');
  pane.scrollLeft = recenter ? scrollLeftForToday(result.axis, today, pane.clientWidth) : previousScroll;
  recenter = false;
  panels.update({ domain: state.snapshot.domain, planning: state.planning, load: result.load, view: result.view, prefs });
}

root.addEventListener('click', (event) => {
  const el = (selector) => event.target.closest(selector);
  if (el('[data-tog]')) {
    const key = el('[data-tog]').dataset.tog;
    const collapsed = new Set(prefs.collapsed);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    setPrefs({ collapsed: [...collapsed] });
  } else if (el('[data-open]')) {
    panels.openIssue(el('[data-open]').dataset.open);
    draw();
  } else if (el('[data-person]')) {
    panels.openPerson(el('[data-person]').dataset.person);
  } else if (el('[data-zoom]')) {
    recenter = true;
    setPrefs({ zoom: el('[data-zoom]').dataset.zoom, dayWidth: null });
  } else if (el('[data-action="refresh"]')) {
    controller.refresh();
  } else if (el('[data-action="settings"]')) {
    panels.openSettings();
  } else if (el('[data-action="print"]')) {
    if (printOverride) return;
    printOverride = { zoom: 'all', collapsed: [] };
    draw();
    const restore = () => {
      printOverride = null;
      recenter = true;
      draw();
    };
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
  }
});

root.addEventListener('change', (event) => {
  if (!event.target.matches('[data-zoom-range]')) return;
  recenter = true;
  setPrefs({ zoom: 'custom', dayWidth: Number(event.target.value) });
});

window.addEventListener('hashchange', () => {
  recenter = true;
  prefs = { ...prefs, lastRoute: location.hash || '#/' };
  savePrefs(prefs);
  draw();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(draw, 150);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    panels.close();
    draw();
  }
});

controller.start();
