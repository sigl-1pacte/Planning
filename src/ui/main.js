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
import { resolveConflicts } from './conflictResolution.js';

const api = createApi();
const root = document.getElementById('app');
const overlay = document.getElementById('key-overlay');
let prefs = loadPrefs();
let recenter = true;
let printOverride = null;
const undo = createUndo();
let lastAxis = null;
let lastTeamId = null;
let drag = null;
let suppressNextClick = false;

if (!location.hash && prefs.lastRoute !== '#/') location.hash = prefs.lastRoute;

const showKey = (reason) => renderKeyScreen(overlay, { api, reason, onValidated: () => controller.start() });

const controller = createController({ api, render: draw, showKeyScreen: showKey });

// Point de passage unique pour toute écriture qui touche Linear (édition de
// champ, replanification, dépendances, contributeurs, glisser-déposer…) :
// applique le domaine à jour renvoyé par la route (le serveur a déjà forcé
// un rafraîchissement Linear avant de répondre, inutile d'attendre jusqu'à
// 30 s le prochain sondage), et recharge aussi la planification (parts,
// capacités, réglages) — certaines écritures Linear purgent des données
// côté base (ex. retirer un contributeur), qui doivent apparaître à jour
// tout de suite plutôt qu'au prochain sondage. Utilisé après une écriture
// ET après son annulation, puisque l'annulation est elle-même une écriture.
async function applyWriteResult(api, result) {
  if (result?.domain) controller.state.snapshot = { ...controller.state.snapshot, domain: result.domain };
  controller.state.planning = await api.planning();
}

const panels = createPanels({
  drawer: document.getElementById('drw'),
  title: document.getElementById('dwT'),
  body: document.getElementById('dwB'),
  closeButton: document.getElementById('dwX'),
  onMutate: (call) => controller.mutate(call),
  onWrite: (call, label, restore) => {
    controller.mutate(async (api) => {
      await applyWriteResult(api, await call(api));
      if (restore) {
        undo.arm(label, async () => {
          await applyWriteResult(api, await restore(api));
          draw();
        });
      }
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
        await applyWriteResult(api, await api.reschedule(issueId, dates));
        draw();
        return controller.state.planning;
      });
    },
  });
  lastAxis = result.axis;
  lastTeamId = result.view.teamId;
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
    fitSheetToOnePage();
    const restore = () => {
      const sheet = root.querySelector('.sheet');
      if (sheet) sheet.style.zoom = '';
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
  } else if (el('[data-action="resolve-conflicts"]')) {
    resolveConflictsInScope();
  }
});

// Résolution automatique des conflits de dépendances, limitée à la team
// affichée (ou au workspace entier en vue globale). Rejoue chaque conflit
// un par un via la même route de replanification en cascade que le
// glisser-déposer et le panneau, en relisant l'état entre chaque décalage
// (un décalage peut en révéler ou en résoudre d'autres plus loin dans la
// chaîne). Une seule annulation couvre tout le lot, dans l'ordre inverse.
function resolveConflictsInScope() {
  controller.mutate(async (api) => {
    const teamId = lastTeamId;
    const { domain, fixed, originals, blockedByCycle } = await resolveConflicts(
      controller.state.snapshot.domain, teamId, (id, dates) => api.reschedule(id, dates),
    );
    if (blockedByCycle || fixed === 0) return controller.state.planning;
    controller.state.snapshot = { ...controller.state.snapshot, domain };
    controller.state.planning = await api.planning();
    undo.arm(`${fixed} conflit${fixed > 1 ? 's' : ''} résolu${fixed > 1 ? 's' : ''}`, async (api2) => {
      let current = controller.state.snapshot.domain;
      for (const o of [...originals].reverse()) {
        const result = await api2.reschedule(o.issueId, { start: o.start, end: o.end });
        current = result.domain;
      }
      controller.state.snapshot = { ...controller.state.snapshot, domain: current };
      controller.state.planning = await api2.planning();
      draw();
    });
    draw();
    return controller.state.planning;
  });
}

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

// Réduit la feuille imprimée pour qu'elle tienne sur une seule page dans la
// mesure du raisonnable : une échelle uniforme (jamais d'agrandissement, et
// jamais en dessous de 40 % pour rester lisible) calculée à partir de la
// hauteur/largeur imprimables réelles de la page — cohérent avec @page dans
// styles.css (A3 paysage, marges de 8 mm). Un très gros planning restera sur
// plusieurs pages plutôt que de devenir illisible : c'est le compromis
// « raisonnable » plutôt qu'un ajustement garanti en toute circonstance.
//
// Utilise style.zoom (non standard, mais géré par Chrome/Edge/Safari et par
// Firefox depuis 2024) plutôt que transform:scale() : un transform ne change
// que le rendu, pas la place réservée dans la mise en page, donc l'impression
// découperait quand même les pages à la hauteur d'origine, blanc compris. zoom
// reflow réellement l'élément à la taille réduite, ce qui est indispensable
// ici. Si zoom n'a aucun effet sur un navigateur donné, l'impression reste
// simplement sur plusieurs pages comme avant — aucune régression possible.
const PRINT_PAGE_MM = { width: 420, height: 297, margin: 8 };
const MIN_PRINT_SCALE = 0.4;

function fitSheetToOnePage() {
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  sheet.style.zoom = '';
  const pxPerMm = 96 / 25.4;
  const maxWidth = (PRINT_PAGE_MM.width - 2 * PRINT_PAGE_MM.margin) * pxPerMm;
  const maxHeight = (PRINT_PAGE_MM.height - 2 * PRINT_PAGE_MM.margin) * pxPerMm;
  const rect = sheet.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.max(MIN_PRINT_SCALE, Math.min(1, maxWidth / rect.width, maxHeight / rect.height));
  if (scale < 1) sheet.style.zoom = String(scale);
}

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
    await applyWriteResult(api, await api.reschedule(issueId, { start, end }));
    undo.arm(`${identifier} déplacée`, async (api2) => {
      await applyWriteResult(api2, await api2.reschedule(issueId, { start: origStart, end: origEnd }));
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
