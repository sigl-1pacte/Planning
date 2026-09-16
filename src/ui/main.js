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
import { shortDay, esc } from './render/format.js';
import { todayISO, addDays } from '../shared/calendar.js';
import { createUndo } from './undo.js';
import { dayDeltaFromPixels, shiftedDates, transitiveDependents } from './dragReschedule.js';
import { resolveConflicts } from './conflictResolution.js';
import { renderLoadChart } from './render/loadChart.js';
import { renderIssueBar } from './render/board.js';

const api = createApi();
const root = document.getElementById('app');
const overlay = document.getElementById('key-overlay');
let prefs = loadPrefs();
let recenter = true;
let printOverride = null;
const undo = createUndo();
let lastAxis = null;
let lastTeamId = null;
let lastLoad = null;
let lastPeople = null;
let drag = null;
let milestoneDrag = null;
let resizeDrag = null;
let suppressNextClick = false;
const dragTip = document.getElementById('tip');

// Petite bulle ancrée en haut au centre de l'écran pendant un glisser-déposer
// (tâche, bord de tâche ou jalon) : date(s) visées et delta en jours. #tip
// existe déjà dans index.html (transition d'opacité déjà en place, cf.
// styles.css, position ancrée plutôt que suivant le curseur) mais n'était
// utilisé nulle part ; on lui donne enfin un rôle.
const deltaLabel = (n) => (n === 0 ? '' : ` (${n > 0 ? '+' : ''}${n} j)`);
function showDragTip(html) {
  if (!dragTip) return;
  dragTip.innerHTML = html;
  dragTip.style.opacity = '1';
}
function hideDragTip() {
  if (dragTip) dragTip.style.opacity = '0';
}

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
  // Le nouveau domaine (dates, statut, jalons...) est déjà là : on l'affiche
  // tout de suite plutôt que d'attendre le second aller-retour réseau
  // (/api/planning) qui ne concerne que les parts/capacités dérivées.
  draw();
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
  lastLoad = result.load;
  lastPeople = result.view.people;
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
  refreshLoadChart();
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
  } else if (el('[data-milestone]')) {
    panels.openMilestone(el('[data-milestone]').dataset.milestone);
    draw();
  } else if (el('[data-zoom]')) {
    recenter = true;
    setPrefs({ zoom: el('[data-zoom]').dataset.zoom, dayWidth: null });
  } else if (el('[data-action="refresh"]')) {
    controller.refresh();
  } else if (el('[data-action="settings"]')) {
    panels.openSettings();
  } else if (el('[data-action="add-team"]')) {
    panels.openTeam();
    draw();
  } else if (el('[data-action="print"]')) {
    if (printOverride) return;
    printOverride = { zoom: 'month', collapsed: [] };
    draw();
    fitSheetToPageWidth();
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
    const btn = el('[data-action="add-project"]');
    panels.openProject(null, { teamId: btn.dataset.team });
    draw();
  } else if (el('[data-action="undo"]')) {
    undo.trigger();
  } else if (el('[data-action="resolve-conflicts"]')) {
    resolveConflictsInScope();
  } else if (el('[data-action="load-chart"]')) {
    openLoadChart();
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
  const diamond = event.target.closest('.jd');
  if (diamond && lastAxis) {
    const domain = controller.state.snapshot?.domain;
    let project = null;
    let milestone = null;
    for (const p of domain?.projects ?? []) {
      const m = p.milestones.find((mm) => mm.id === diamond.dataset.milestone);
      if (m) { project = p; milestone = m; break; }
    }
    if (!milestone) return;
    const parts = [...root.querySelectorAll(`[data-milestone="${milestone.id}"]`)];
    milestoneDrag = {
      pointerId: event.pointerId, parts, milestoneId: milestone.id, name: milestone.name,
      origDate: milestone.date, startX: event.clientX, dayWidth: lastAxis.dayWidth, dayDelta: 0,
    };
    diamond.setPointerCapture(event.pointerId);
    root.classList.add('dragging');
    event.preventDefault();
    return;
  }
  const handle = event.target.closest('.rsz');
  if (handle && lastAxis) {
    const row = handle.closest('.r.tk');
    const domain = controller.state.snapshot?.domain;
    const issue = row && domain?.issues.find((i) => i.id === row.dataset.t);
    if (!issue?.start || !issue.end) return;
    // Couleur/statut lus sur la barre déjà rendue plutôt que recalculés :
    // main.js n'a pas accès à la couleur de projet ni à issueStatus(), et
    // cet aperçu n'a besoin que de reproduire ce qui est déjà à l'écran.
    const sampleBar = row.querySelector('.bar');
    const isBlocked = sampleBar?.classList.contains('block') ?? false;
    // Glisser la fin peut créer un conflit chez les dépendantes : prévisualisées
    // en mouvement, comme pour le déplacement complet de la barre.
    const rightRows = [...root.querySelectorAll('[data-right] .r.tk')];
    const rowById = new Map(rightRows.map((el) => [el.dataset.t, el]));
    const affectedRows = handle.dataset.edge === 'end'
      ? transitiveDependents(domain.issues, issue.id).map((id) => rowById.get(id)).filter(Boolean) : [];
    resizeDrag = {
      pointerId: event.pointerId, row, issueId: issue.id, identifier: issue.identifier, edge: handle.dataset.edge,
      issueStatus: issue.status, barColor: sampleBar?.style.backgroundColor || '', isBlocked,
      holidays: new Set(controller.state.planning.holidays.map((h) => h.day)),
      origStart: issue.start, origEnd: issue.end, startX: event.clientX, dayWidth: lastAxis.dayWidth, dayDelta: 0,
      affectedRows,
    };
    for (const r of affectedRows) r.classList.add('drag-affected');
    handle.setPointerCapture(event.pointerId);
    root.classList.add('dragging');
    event.preventDefault();
    return;
  }
  const bar = event.target.closest('.bar');
  if (!bar || !lastAxis) return;
  const row = bar.closest('.r.tk');
  const domain = controller.state.snapshot?.domain;
  const issue = row && domain?.issues.find((i) => i.id === row.dataset.t);
  if (!issue?.start || !issue.end) return;
  // Les dépendantes transitives sont prévisualisées en mouvement avec la
  // barre déplacée : c'est bien elles que la cascade décalera au dépôt.
  const rightRows = [...root.querySelectorAll('[data-right] .r.tk')];
  const rowById = new Map(rightRows.map((el) => [el.dataset.t, el]));
  const affectedRows = transitiveDependents(domain.issues, issue.id).map((id) => rowById.get(id)).filter(Boolean);
  drag = {
    pointerId: event.pointerId, row, issueId: issue.id, identifier: issue.identifier,
    origStart: issue.start, origEnd: issue.end, startX: event.clientX, dayWidth: lastAxis.dayWidth, dayDelta: 0,
    affectedRows,
  };
  for (const r of affectedRows) r.classList.add('drag-affected');
  bar.setPointerCapture(event.pointerId);
  root.classList.add('dragging');
  event.preventDefault();
});

root.addEventListener('pointermove', (event) => {
  if (milestoneDrag && event.pointerId === milestoneDrag.pointerId) {
    const dayDelta = dayDeltaFromPixels(event.clientX - milestoneDrag.startX, milestoneDrag.dayWidth);
    const newDate = addDays(milestoneDrag.origDate, dayDelta);
    showDragTip(`<b>${esc(milestoneDrag.name)}</b><br>${shortDay(newDate)}${deltaLabel(dayDelta)}`);
    if (dayDelta === milestoneDrag.dayDelta) return;
    milestoneDrag.dayDelta = dayDelta;
    const tx = `translateX(${dayDelta * milestoneDrag.dayWidth}px)`;
    for (const p of milestoneDrag.parts) p.style.transform = tx;
    const label = milestoneDrag.parts.find((p) => p.classList.contains('jt'));
    if (label) label.textContent = `${milestoneDrag.name} · ${shortDay(newDate)}`;
    return;
  }
  if (resizeDrag && event.pointerId === resizeDrag.pointerId) {
    const dayDelta = dayDeltaFromPixels(event.clientX - resizeDrag.startX, resizeDrag.dayWidth);
    const newStart = resizeDrag.edge === 'start' ? addDays(resizeDrag.origStart, dayDelta) : resizeDrag.origStart;
    const newEnd = resizeDrag.edge === 'end' ? addDays(resizeDrag.origEnd, dayDelta) : resizeDrag.origEnd;
    const fieldLabel = resizeDrag.edge === 'start' ? 'Début' : 'Échéance';
    const shownDate = resizeDrag.edge === 'start' ? newStart : newEnd;
    showDragTip(`<b>${esc(resizeDrag.identifier)}</b><br>${fieldLabel} : ${shortDay(shownDate)}${deltaLabel(dayDelta)}`);
    if (dayDelta === resizeDrag.dayDelta) return;
    resizeDrag.dayDelta = dayDelta;
    if (newStart > newEnd) return; // aperçu invalide (bord glissé au-delà de l'autre) : on garde le dernier rendu valide
    // Le corps de la barre s'étire/rétrécit réellement (pas une simple
    // translation) : on redécoupe les tronçons ouvrés en direct avec les
    // vraies nouvelles dates, plutôt qu'une approximation.
    renderIssueBar(
      resizeDrag.row, { id: resizeDrag.issueId, start: newStart, end: newEnd, status: resizeDrag.issueStatus },
      { color: resizeDrag.barColor, status: resizeDrag.isBlocked ? 'blocked' : resizeDrag.issueStatus, axis: lastAxis, holidays: resizeDrag.holidays },
    );
    if (resizeDrag.edge === 'end' && resizeDrag.affectedRows.length) {
      const tx = `translateX(${dayDelta * resizeDrag.dayWidth}px)`;
      for (const r of resizeDrag.affectedRows) r.querySelectorAll('.bar, .gp, .bl').forEach((el) => { el.style.transform = tx; });
    }
    return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dayDelta = dayDeltaFromPixels(event.clientX - drag.startX, drag.dayWidth);
  const { start, end } = shiftedDates(drag.origStart, drag.origEnd, dayDelta);
  showDragTip(`<b>${esc(drag.identifier)}</b><br>${shortDay(start)} → ${shortDay(end)}${deltaLabel(dayDelta)}`);
  if (dayDelta === drag.dayDelta) return;
  drag.dayDelta = dayDelta;
  const tx = `translateX(${dayDelta * drag.dayWidth}px)`;
  for (const r of [drag.row, ...drag.affectedRows]) {
    r.querySelectorAll('.bar, .gp, .bl').forEach((el) => { el.style.transform = tx; });
  }
  const label = drag.row.querySelector('.bl');
  if (label) label.textContent = dayDelta === 0 ? label.textContent : `${shortDay(start)} → ${shortDay(end)}`;
});

// Réduit la feuille imprimée pour qu'elle tienne sur une seule page dans la
// mesure du raisonnable : une échelle uniforme (jamais d'agrandissement, et
// jamais en dessous de 40 % pour rester lisible) calculée à partir de la
// hauteur/largeur imprimables réelles de la page — cohérent avec @page dans
// styles.css (A4 portrait, marges de 8 mm ; un mauvais accord entre ce
// calcul et la taille réelle de sortie fait paraître le résultat trop petit
// avec beaucoup de blanc, la mise à l'échelle du navigateur/pilote
// d'impression s'ajoutant à celle-ci). Un très gros planning restera sur
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
// Page A4 paysage (bien plus adaptée à un planning large qu'un portrait) :
// on ne réduit que la largeur pour qu'elle tienne sur une page, jamais la
// hauteur — la lecture papier n'a pas besoin d'une seule page, elle a besoin
// de texte lisible. Le zoom d'écran est fixé à 'mois' avant l'impression
// (voir data-action="print") pour partir d'une densité déjà raisonnable :
// ce réglage ne fait qu'ajuster la marge qu'il reste à rattraper.
const PRINT_PAGE_MM = { width: 297, margin: 10 };
const MIN_PRINT_SCALE = 0.72;

function fitSheetToPageWidth() {
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  sheet.style.zoom = '';
  const pxPerMm = 96 / 25.4;
  const maxWidth = (PRINT_PAGE_MM.width - 2 * PRINT_PAGE_MM.margin) * pxPerMm;
  const rect = sheet.getBoundingClientRect();
  if (!rect.width) return;
  const scale = Math.max(MIN_PRINT_SCALE, Math.min(1, maxWidth / rect.width));
  if (scale < 1) sheet.style.zoom = String(scale);
}

function endDrag(commit) {
  if (!drag) return;
  root.classList.remove('dragging');
  hideDragTip();
  for (const r of drag.affectedRows) r.classList.remove('drag-affected');
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

function endMilestoneDrag(commit) {
  if (!milestoneDrag) return;
  root.classList.remove('dragging');
  hideDragTip();
  const { milestoneId, name, origDate, dayDelta } = milestoneDrag;
  milestoneDrag = null;
  if (dayDelta === 0) return;
  if (!commit) { draw(); return; }
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);
  const newDate = addDays(origDate, dayDelta);
  controller.mutate(async (api) => {
    await applyWriteResult(api, await api.updateMilestone(milestoneId, newDate));
    undo.arm(`Jalon « ${name} » déplacé`, async (api2) => {
      await applyWriteResult(api2, await api2.updateMilestone(milestoneId, origDate));
      draw();
    });
    draw();
    return controller.state.planning;
  });
}

// Glisser un bord de barre ne modifie que cette date-là (pas de cascade sur
// le début, contrairement au déplacement complet de la barre) — sauf sur le
// bord de fin : les dépendantes ne bougent pas automatiquement avec ce
// mode-là, donc un conflit qu'il crée est résolu juste après, via la même
// mécanique que le bouton « Résoudre les conflits » (sa propre annulation
// indépendante, plutôt qu'une seule annulation combinée plus fragile).
function endResizeDrag(commit) {
  if (!resizeDrag) return;
  root.classList.remove('dragging');
  hideDragTip();
  for (const r of resizeDrag.affectedRows) r.classList.remove('drag-affected');
  const { issueId, identifier, edge, origStart, origEnd, dayDelta } = resizeDrag;
  resizeDrag = null;
  if (dayDelta === 0) return;
  if (!commit) { draw(); return; }
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);
  const field = edge === 'start' ? 'start' : 'end';
  const newValue = addDays(edge === 'start' ? origStart : origEnd, dayDelta);
  const origValue = edge === 'start' ? origStart : origEnd;
  controller.mutate(async (api) => {
    await applyWriteResult(api, await api.updateIssue(issueId, { [field]: newValue }));
    undo.arm(`${identifier} : ${edge === 'start' ? 'début' : 'échéance'} modifié`, async (api2) => {
      await applyWriteResult(api2, await api2.updateIssue(issueId, { [field]: origValue }));
      draw();
    });
    draw();
    return controller.state.planning;
  }).then(() => {
    if (edge === 'end') resolveConflictsInScope();
  });
}

root.addEventListener('pointerup', () => { endDrag(true); endMilestoneDrag(true); endResizeDrag(true); });
root.addEventListener('pointercancel', () => { endDrag(false); endMilestoneDrag(false); endResizeDrag(false); });

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
    closeLoadChart();
    panels.close();
    draw();
  }
});

// Popup « Charge vs disponibilité », ouvert depuis le bouton du bandeau de
// charge — construit à la volée (pas de squelette statique dans index.html)
// à partir des mêmes données déjà calculées pour l'affichage courant
// (team affichée ou workspace entier).
function closeLoadChart() {
  document.querySelector('.chart-overlay')?.remove();
}

// Rejoue le rendu avec les données les plus fraîches (lastLoad/lastPeople,
// recalculées à chaque draw()) plutôt qu'un instantané figé à l'ouverture :
// sans ça, la popup restait ouverte sur des chiffres périmés dès qu'une
// disponibilité changeait ailleurs (réglages d'une personne, replanification…)
// pendant qu'elle était affichée.
function applyRecommendation(reco) {
  controller.mutate(async (api) => {
    await applyWriteResult(api, await reco.apply(api));
    draw();
    refreshLoadChart();
    return controller.state.planning;
  });
}

function refreshLoadChart() {
  const chart = document.querySelector('.chart-overlay [data-chart]');
  if (!chart || !lastLoad || !lastAxis) return;
  renderLoadChart(chart, {
    domain: controller.state.snapshot.domain, planning: controller.state.planning,
    load: lastLoad, people: lastPeople,
    users: controller.state.snapshot.domain.users,
    ceiling: controller.state.planning.settings.loadCeilingPct,
    teamScoped: lastTeamId !== null, teamId: lastTeamId, range: lastAxis,
    onApply: applyRecommendation,
  });
}

function openLoadChart() {
  if (document.querySelector('.chart-overlay') || !lastLoad) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay chart-overlay';
  const box = document.createElement('div');
  box.className = 'chartbox';
  box.innerHTML = '<button class="x" type="button" data-action="close-chart" aria-label="Fermer">×</button><div data-chart></div>';
  overlay.appendChild(box);
  // En dehors de #app (qui est intégralement remplacé à chaque draw()) : la
  // popup doit survivre à un rafraîchissement de fond, donc sa propre
  // gestion de clic, indépendante du délégué de #app.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-action="close-chart"]')) closeLoadChart();
  });
  document.body.appendChild(overlay);
  refreshLoadChart();
}

controller.start();
