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
import { shortDay } from './render/format.js';
import { todayISO } from '../shared/calendar.js';
import { createUndo } from './undo.js';
import { dayDeltaFromPixels, shiftedDates } from './dragReschedule.js';

const api = createApi();
const root = document.getElementById('app');
const overlay = document.getElementById('key-overlay');
let prefs = loadPrefs();
let recenter = true;
let printOverride = null;
const undo = createUndo();
let lastAxis = null;
let drag = null;
let suppressNextClick = false;

if (!location.hash && prefs.lastRoute !== '#/') location.hash = prefs.lastRoute;

const showKey = (reason) => renderKeyScreen(overlay, { api, reason, onValidated: () => controller.start() });

const controller = createController({ api, render: draw, showKeyScreen: showKey });

const panels = createPanels({
  drawer: document.getElementById('drw'),
  title: document.getElementById('dwT'),
  body: document.getElementById('dwB'),
  closeButton: document.getElementById('dwX'),
  onMutate: (call) => controller.mutate(call),
  onWrite: (call, label, restore) => {
    controller.mutate(async (api) => {
      const result = await call(api);
      if (restore) undo.arm(label, async () => { await restore(api); draw(); });
      draw();
      return controller.state.planning;
    });
  },
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
    onPlan: (issueId, dates) => {
      controller.mutate(async (api) => {
        await api.reschedule(issueId, dates);
        draw();
        return controller.state.planning;
      });
    },
  });
  lastAxis = result.axis;
  const pane = root.querySelector('.pr');
  pane.scrollLeft = recenter ? scrollLeftForToday(result.axis, today, pane.clientWidth) : previousScroll;
  recenter = false;
  panels.update({ domain: state.snapshot.domain, planning: state.planning, load: result.load, view: result.view, prefs });
  const pending = undo.current();
  let toast = root.querySelector('.undo-toast');
  if (pending) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'undo-toast';
      toast.innerHTML = '<span></span><button class="btn" type="button" data-action="undo">Annuler</button>';
      root.appendChild(toast);
    }
    toast.querySelector('span').textContent = pending.label;
  } else if (toast) {
    toast.remove();
  }
}

root.addEventListener('click', (event) => {
  if (suppressNextClick) { suppressNextClick = false; return; }
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
  } else if (el('[data-action="add-task"]')) {
    const btn = el('[data-action="add-task"]');
    panels.openIssue(null, { teamId: btn.dataset.team, projectId: btn.dataset.project || undefined });
    draw();
  } else if (el('[data-action="add-project"]')) {
    panels.openProject(null);
    draw();
  } else if (el('[data-action="undo"]')) {
    undo.trigger();
  }
});

// Glisser-déposer d'une barre : décale début et échéance du même nombre de
// jours calendaires (pas de bornage aux jours ouvrés, comme une saisie
// manuelle de date dans le panneau), puis passe par la même route de
// replanification en cascade que le bouton « Replanifier ». Le déclic est
// distingué du clic simple par le nombre de jours réellement franchis : sans
// déplacement, aucun appel n'est fait et le clic normal (ouverture du
// panneau) reprend la main.
root.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const bar = event.target.closest('.bar');
  if (!bar || !lastAxis) return;
  const row = bar.closest('.r.tk');
  const issue = row && controller.state.snapshot?.domain.issues.find((i) => i.id === row.dataset.t);
  if (!issue?.start || !issue.end) return;
  drag = {
    pointerId: event.pointerId, row, issueId: issue.id, identifier: issue.identifier,
    origStart: issue.start, origEnd: issue.end, startX: event.clientX, dayWidth: lastAxis.dayWidth, dayDelta: 0,
  };
  bar.setPointerCapture(event.pointerId);
  root.classList.add('dragging');
  event.preventDefault();
});

root.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dayDelta = dayDeltaFromPixels(event.clientX - drag.startX, drag.dayWidth);
  if (dayDelta === drag.dayDelta) return;
  drag.dayDelta = dayDelta;
  const tx = `translateX(${dayDelta * drag.dayWidth}px)`;
  drag.row.querySelectorAll('.bar, .gp, .bl').forEach((el) => { el.style.transform = tx; });
  const label = drag.row.querySelector('.bl');
  if (label) {
    const { start, end } = shiftedDates(drag.origStart, drag.origEnd, dayDelta);
    label.textContent = dayDelta === 0 ? label.textContent : `${shortDay(start)} → ${shortDay(end)}`;
  }
});

function endDrag(commit) {
  if (!drag) return;
  root.classList.remove('dragging');
  const { issueId, identifier, origStart, origEnd, dayDelta } = drag;
  drag = null;
  if (dayDelta === 0) return;
  if (!commit) { draw(); return; }
  suppressNextClick = true;
  // Filet de sécurité si le clic de fin de déclic ne se déclenche pas (cas
  // limite selon navigateur) : ne bloque pas indéfiniment le clic suivant.
  setTimeout(() => { suppressNextClick = false; }, 0);
  const { start, end } = shiftedDates(origStart, origEnd, dayDelta);
  controller.mutate(async (api) => {
    await api.reschedule(issueId, { start, end });
    undo.arm(`${identifier} déplacée`, async (api2) => {
      await api2.reschedule(issueId, { start: origStart, end: origEnd });
      draw();
    });
    draw();
    return controller.state.planning;
  });
}

root.addEventListener('pointerup', () => endDrag(true));
root.addEventListener('pointercancel', () => endDrag(false));

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
