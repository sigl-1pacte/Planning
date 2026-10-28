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
import { shortDay, esc, CLOSE_ICON } from './render/format.js';
import { todayISO, addDays } from '../shared/calendar.js';
import { createUndo } from './undo.js';
import { dayDeltaFromPixels, shiftedDates, transitiveDependents } from './dragReschedule.js';
import { resolveConflicts } from './conflictResolution.js';
import { renderLoadChart } from './render/loadChart.js';
import { renderIssueBar } from './render/board.js';
import { dropState } from './render/kanban.js';
import { EMPTY_FILTER, PRESETS, describeFilter, issueFilter, normalizeFilter } from '../shared/filters.js';
import { AuthError } from './api.js';
import { previewOf, previews } from './optimistic.js';
import { weekBreakdown } from '../shared/load.js';
import { applyTheme, createEasterEgg } from './theme.js';
import { weekCardHtml } from './render/weekCard.js';
import { planPrintColumns, printTimelineWidth, buildPrintPages, clearPrintPages } from './print.js';
import { buildMarkdown, markdownFileName } from './exportMarkdown.js';

const api = createApi({ getDomain: () => controller.writeDomain() });
const root = document.getElementById('app');
const overlay = document.getElementById('key-overlay');
let prefs = loadPrefs();
let recenter = true;
// Zoom au curseur : jour (fractionnaire) au centre de la frise avant le
// changement, recentré après — comme un pincement sur une carte.
let zoomAnchor = null;
let keepRail = false;
// Pendant une impression : largeur de jour et colonnes de période choisies
// pour le papier (voir print.js), appliquées à chaque draw() jusqu'à
// afterprint — y compris si une actualisation de fond survient pendant que
// la boîte d'impression est ouverte.
let printLayout = null;
const undo = createUndo();
let lastAxis = null;
let lastTeamId = null;
let lastLoad = null;
let lastPeople = null;
let drag = null;
let milestoneDrag = null;
let resizeDrag = null;
let cardDrag = null;
// Colonnes fermées du kanban dépliées en entier (le temps de la session).
const kanbanExpanded = new Set();
// Vues enregistrées de la personne connectée (serveur), lues au premier rendu
// une fois la clé acceptée. Sans elles (route absente, base injoignable), les
// vues par défaut restent ; « Mes tâches » attend `me`.
const viewsState = { requested: false, me: null, views: null, error: null, naming: false, pendingDelete: null };
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
// l'écran la montre tout de suite (aperçu local, optimistic.js), puis elle
// part dans la file du contrôleur, qui relit Linear une fois la file vide.
// `restore` (une écriture elle aussi) est proposée en annulation tant que le
// bandeau reste affiché ; retirée si l'écriture échoue. Résout comme
// controller.mutate : au résultat, ou à false en cas d'échec.
//
// `call` peut aussi être une liste (l'enregistrement d'un panneau qui touche
// plusieurs choses) : une écriture de la file par élément, dans l'ordre, pour
// que chacune parte du résultat de la précédente (ex. la description puis les
// dates, qui réécrivent toutes deux la description). `restore` est alors la
// liste des retours en arrière, rejoués en sens inverse par une seule
// annulation. Résout à false si l'une échoue, sinon au dernier résultat avec
// les avertissements de toutes.
function write(call, label, restore) {
  if (Array.isArray(call)) return writeAll(call, label, restore);
  const armed = restore ? undo.arm(label, () => write(restore)) : null;
  const done = controller.mutate(call, { preview: previewOf(call) });
  if (armed) {
    done.then((result) => {
      if (result === false && undo.disarm(armed)) draw();
    });
  }
  return done;
}

function writeAll(calls, label, restores) {
  const back = restores?.length ? [...restores].reverse() : null;
  const armed = back ? undo.arm(label, () => writeAll(back)) : null;
  const done = Promise.all(calls.map((call) => controller.mutate(call, { preview: previewOf(call) })))
    .then((results) => (results.includes(false)
      ? false
      : { ...results.at(-1), warnings: results.flatMap((r) => r?.warnings ?? []) }));
  if (armed) {
    done.then((result) => {
      if (result === false && undo.disarm(armed)) draw();
    });
  }
  return done;
}

const panels = createPanels({
  drawer: document.getElementById('drw'),
  title: document.getElementById('dwT'),
  body: document.getElementById('dwB'),
  closeButton: document.getElementById('dwX'),
  onMutate: (call) => controller.mutate(call),
  onWrite: async (call, label, restore) => {
    // Une écriture peut réussir en partie (tâche créée, mais une dépendance
    // ou une notification refusée par Linear) : elle le signale dans
    // `warnings`. On l'affiche après coup, car mutate() efface l'erreur en
    // cas de succès.
    const result = await write(call, label, restore);
    if (result === false) return false;
    if (result.warnings?.length) {
      controller.state.error = `${label}, mais : ${result.warnings.join(' ; ')}.`;
      draw();
    }
    return true;
  },
  lastError: () => controller.state.error,
  onPrefs: (patch) => setPrefs(patch),
  onForgetKey: () => {
    api.forgetKey();
    controller.stop();
    panels.close();
    showKey(null);
  },
});

// Thème : appliqué au démarrage, à chaque changement de réglage, et quand le
// système passe de clair à sombre (choix « automatique »).
const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');
const syncTheme = () => applyTheme(prefs, { systemDark: Boolean(systemDark?.matches) });
syncTheme();
systemDark?.addEventListener?.('change', syncTheme);

function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  savePrefs(prefs);
  syncTheme();
  draw();
}

// Mode rose : une floraison part du logo, et un mot (qui dit aussi comment
// revenir) s'efface tout seul.
const easterEgg = createEasterEgg({
  onTrigger: () => {
    const pink = !prefs.pink;
    setPrefs({ pink, pinkFound: true });
    const logo = root.querySelector('.rail .logo')?.getBoundingClientRect();
    if (pink && logo) {
      const bloom = document.createElement('div');
      bloom.className = 'bloom';
      bloom.style.left = `${logo.left + logo.width / 2}px`;
      bloom.style.top = `${logo.top + logo.height / 2}px`;
      document.body.appendChild(bloom);
      bloom.addEventListener('animationend', () => bloom.remove());
      setTimeout(() => bloom.remove(), 1500);
    }
    flash(pink
      ? 'Mode rose activé<span>· cinq clics sur le logo pour revenir</span>'
      : 'Mode rose désactivé<span>· il reste dans les réglages</span>', 'egg-toast');
  },
});

// Mise en page téléphone (styles.css) et écran tactile : sur ordinateur,
// rien ne change.
const PHONE = window.matchMedia?.('screen and (max-width:760px) and (pointer:coarse)');
const TOUCH_SCREEN = window.matchMedia?.('(hover:none) and (pointer:coarse)');

function estimatedPaneWidth() {
  if (!PHONE?.matches) return Math.max(300, window.innerWidth - 686);
  const sheet = root.querySelector('.sheet');
  const column = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--PL')) || 600;
  if (!sheet?.clientWidth) return Math.max(300, window.innerWidth - column - 86);
  const style = getComputedStyle(sheet);
  const inner = sheet.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  return Math.max(120, inner - column - 1);
}

function draw() {
  const { state } = controller;
  if (!state.snapshot || !state.planning) {
    if (state.error) renderLoadError(root, state.error);
    return;
  }
  const previousScroll = root.querySelector('.pr')?.scrollLeft ?? 0;
  const today = todayISO();
  // Avant le premier rendu (squelette), la frise n'existe pas encore : largeur
  // déduite de la feuille du squelette (mêmes marges) moins la colonne des
  // tâches, dont la largeur change sur téléphone.
  const viewportWidth = root.querySelector('.pr')?.clientWidth || estimatedPaneWidth();
  const effective = printLayout ? { ...prefs, zoom: 'custom', dayWidth: printLayout.dayWidth, collapsed: [] } : prefs;
  if (!viewsState.requested) loadViews();
  // La barre de filtres est redessinée avec la feuille : la saisie en cours
  // et le menu ouvert y sont remis tels quels.
  const typing = document.activeElement?.matches?.('[data-fb-q], [data-fb-name]')
    ? { sel: document.activeElement.matches('[data-fb-q]') ? '[data-fb-q]' : '[data-fb-name]', value: document.activeElement.value,
      start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null;
  const openMenu = root.querySelector('details[data-fb-dd][open]')?.dataset.fbDd;
  const result = renderApp(root, {
    state,
    route: parseRoute(location.hash),
    prefs: { ...effective, collapsed: new Set(effective.collapsed) },
    selectedIssueId: panels.selectedIssueId(),
    today,
    viewportWidth,
    keepRail,
    kanbanExpanded,
    filters: {
      filter: prefs.filter, viewId: prefs.viewId, views: viewsState.views, viewsError: viewsState.error, me: viewsState.me,
      naming: viewsState.naming, pendingDelete: viewsState.pendingDelete,
    },
    onPlan: (issueId, dates) => {
      write((api) => api.reschedule(issueId, dates));
    },
  });
  root.removeAttribute('aria-busy');
  if (openMenu) root.querySelector(`details[data-fb-dd="${openMenu}"]`)?.setAttribute('open', '');
  const input = typing && root.querySelector(typing.sel);
  if (input) {
    input.value = typing.value;
    input.focus();
    input.setSelectionRange(typing.start, typing.end);
  }
  lastAxis = result.axis;
  lastTeamId = result.view.teamId;
  lastLoad = result.load;
  lastPeople = result.view.people;
  const pane = root.querySelector('.pr');
  if (recenter) pane.scrollLeft = scrollLeftForToday(result.axis, today, pane.clientWidth);
  else if (zoomAnchor !== null) pane.scrollLeft = zoomAnchor * result.axis.dayWidth - pane.clientWidth / 2;
  else pane.scrollLeft = previousScroll;
  recenter = false;
  zoomAnchor = null;
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
  // Hauteur réelle du bandeau (il passe sur deux lignes sur un écran étroit) :
  // les éléments ancrés juste dessous s'y calent.
  const rail = root.querySelector('.rail');
  if (rail) document.documentElement.style.setProperty('--rail-h', `${rail.offsetHeight}px`);
  // Sur téléphone, les onglets défilent sur une ligne : l'onglet actif y est
  // ramené en vue.
  const nav = rail?.querySelector('.nav');
  const tab = nav?.querySelector('a.on');
  if (PHONE?.matches && tab && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = tab.offsetLeft - nav.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
  }
  refreshLoadChart();
  if (printLayout) {
    buildPrintPages(root.querySelector('.sheet'), {
      axis: result.axis, columns: printLayout.columns, title: root.querySelector('.rail h1')?.textContent ?? '',
    });
  }
}

// Petit mot en haut de l'écran qui s'efface tout seul : neutre par défaut,
// rose ('egg-toast') pour le seul mode rose.
function flash(html, className = 'flash-toast') {
  document.querySelector('.egg-toast, .flash-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = className;
  toast.setAttribute('role', 'status');
  toast.innerHTML = html;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2600);
  setTimeout(() => toast.remove(), 3100);
}

// Export Markdown de la vue affichée (exportMarkdown.js) : en fichier
// téléchargé ou dans le presse-papiers.
async function exportMarkdown(mode) {
  const { snapshot } = controller.state;
  root.querySelector('details.mdx')?.removeAttribute('open');
  if (!snapshot) return;
  const route = parseRoute(location.hash);
  const today = todayISO();
  // Le filtre de la frise et du kanban s'applique aussi à l'export, qui le dit.
  const filtered = (!route.tab || route.tab === 'kanban') && issueFilter(prefs.filter, { me: viewsState.me, today });
  const text = buildMarkdown(snapshot.domain, {
    route, showCanceled: prefs.showCanceled, today, fetchedAt: snapshot.fetchedAt,
    filter: filtered || null, filterLabel: filtered ? describeFilter(prefs.filter, snapshot.domain) : null,
  });
  if (mode === 'copy') {
    try {
      await navigator.clipboard.writeText(text);
      flash('Markdown copié<span>· prêt à coller</span>');
    } catch {
      flash('Copie refusée par le navigateur<span>· téléchargez le fichier à la place</span>');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = markdownFileName(snapshot.domain, route, today);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Filtres et vues (filterBar.js). Le filtre vit dans les préférences du
// navigateur ; les vues enregistrées, sur le serveur, au nom de la personne
// connectée : chaque appel rend sa liste à jour.
async function loadViews() {
  viewsState.requested = true;
  try {
    const { me, views } = await api.views();
    Object.assign(viewsState, { me, views, error: null });
  } catch (err) {
    if (err instanceof AuthError) return;
    viewsState.error = err.message;
  }
  draw();
}

async function changeViews(call) {
  try {
    const result = await call(api);
    Object.assign(viewsState, { me: result.me, views: result.views, error: null });
    return result;
  } catch (err) {
    flash(`${esc(err.message)}`);
    draw();
    return null;
  }
}

const setFilter = (patch) => setPrefs({ filter: normalizeFilter({ ...prefs.filter, ...patch }) });

async function saveNamedView() {
  const name = root.querySelector('[data-fb-name]')?.value.trim();
  if (!name) return;
  const result = await changeViews((a) => a.createView(name, normalizeFilter(prefs.filter)));
  if (!result) return;
  viewsState.naming = false;
  setPrefs({ viewId: result.id });
  flash(`Vue « ${esc(name)} » enregistrée`);
}

// Rend true si le clic concernait la barre de filtres.
function filterBarClick(el) {
  if (el('[data-view]')) {
    const id = el('[data-view]').dataset.view;
    const view = [...PRESETS, ...(viewsState.views ?? [])].find((v) => v.id === id);
    setPrefs(view ? { filter: normalizeFilter(view.filter), viewId: view.id } : { filter: { ...EMPTY_FILTER }, viewId: null });
  } else if (el('[data-view-del]')) {
    viewsState.pendingDelete = el('[data-view-del]').dataset.viewDel;
    draw();
  } else if (el('[data-view-del-no]')) {
    viewsState.pendingDelete = null;
    draw();
  } else if (el('[data-view-del-ok]')) {
    const id = el('[data-view-del-ok]').dataset.viewDelOk;
    const name = viewsState.views?.find((v) => v.id === id)?.name ?? '';
    viewsState.pendingDelete = null;
    changeViews((a) => a.deleteView(id)).then((result) => {
      if (!result) return;
      if (prefs.viewId === id) setPrefs({ viewId: null });
      else draw();
      flash(`Vue « ${esc(name)} » supprimée`);
    });
  } else if (el('[data-fb-clear]')) {
    setPrefs({ filter: { ...EMPTY_FILTER }, viewId: null });
  } else if (el('[data-fb-save]')) {
    viewsState.naming = true;
    draw();
    root.querySelector('[data-fb-name]')?.focus();
  } else if (el('[data-fb-save-no]')) {
    viewsState.naming = false;
    draw();
  } else if (el('[data-fb-save-ok]')) {
    saveNamedView();
  } else if (el('[data-fb-update]')) {
    const id = prefs.viewId;
    const name = viewsState.views?.find((v) => v.id === id)?.name ?? '';
    changeViews((a) => a.updateView(id, { filter: normalizeFilter(prefs.filter) })).then((result) => {
      if (!result) return;
      draw();
      flash(`Vue « ${esc(name)} » mise à jour`);
    });
  } else {
    return false;
  }
  return true;
}

let searchTimer = 0;
root.addEventListener('input', (event) => {
  if (!event.target.matches('[data-fb-q]')) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setFilter({ q: event.target.value }), 180);
});

root.addEventListener('change', (event) => {
  const t = event.target;
  if (t.matches('[data-fb-people], [data-fb-projects]')) {
    const key = t.matches('[data-fb-people]') ? 'people' : 'projects';
    setFilter({ [key]: [...root.querySelectorAll(`[data-fb-${key}]:checked`)].map((c) => c.value) });
  } else if (t.matches('[data-fb-due]')) {
    setFilter({ due: t.value || null });
  }
});

root.addEventListener('keydown', (event) => {
  const t = event.target;
  if (t.matches('[data-fb-name]')) {
    if (event.key === 'Enter') saveNamedView();
    if (event.key === 'Escape') {
      event.stopPropagation();
      viewsState.naming = false;
      draw();
    }
  } else if (t.matches('[data-fb-q]') && event.key === 'Escape' && t.value) {
    event.stopPropagation();
    clearTimeout(searchTimer);
    t.value = '';
    setFilter({ q: '' });
  }
});

// Un menu de filtre ouvert se referme quand on clique ailleurs.
document.addEventListener('click', (event) => {
  for (const menu of root.querySelectorAll('details[data-fb-dd][open]')) {
    if (!menu.contains(event.target)) menu.removeAttribute('open');
  }
});

// Le menu Markdown se referme quand on clique ailleurs.
document.addEventListener('click', (event) => {
  const menu = root.querySelector('details.mdx[open]');
  if (menu && !menu.contains(event.target)) menu.removeAttribute('open');
});

root.addEventListener('click', (event) => {
  if (suppressNextClick) { suppressNextClick = false; return; }
  const el = (selector) => event.target.closest(selector);
  if (filterBarClick(el)) return;
  if (el('[data-tog]')) {
    const key = el('[data-tog]').dataset.tog;
    const collapsed = new Set(prefs.collapsed);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    setPrefs({ collapsed: [...collapsed] });
  } else if (el('[data-kb-more]')) {
    kanbanExpanded.add(el('[data-kb-more]').dataset.kbMore);
    draw();
  } else if (el('[data-open]')) {
    panels.openIssue(el('[data-open]').dataset.open);
    draw();
  } else if (el('.rail .logo')) {
    easterEgg.logoClick();
  } else if (el('[data-action="theme"]')) {
    setPrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
  } else if (el('[data-pw]')) {
    openWeekCard(el('[data-pw]'));
  } else if (el('[data-org-roles]')) {
    panels.openRoles(el('[data-org-roles]').dataset.orgRoles || null);
  } else if (el('[data-person]')) {
    panels.openPerson(el('[data-person]').dataset.person);
  } else if (el('[data-milestone]')) {
    panels.openMilestone(el('[data-milestone]').dataset.milestone);
    draw();
  } else if (el('[data-load-mode]')) {
    setPrefs({ loadMode: el('[data-load-mode]').dataset.loadMode });
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
  } else if (el('[data-action="md-download"]') || el('[data-action="md-copy"]')) {
    exportMarkdown(el('[data-action="md-copy"]') ? 'copy' : 'download');
  } else if (el('[data-action="print"]')) {
    preparePrint();
    window.print();
  } else if (el('[data-action="add-milestone"]')) {
    panels.openMilestone(null, { projectId: el('[data-action="add-milestone"]').dataset.project });
    draw();
  } else if (el('[data-action="add-task"]')) {
    const btn = el('[data-action="add-task"]');
    panels.openIssue(null, { teamId: btn.dataset.team, projectId: btn.dataset.project || undefined });
    draw();
  } else if (el('[data-action="add-project"]')) {
    const btn = el('[data-action="add-project"]');
    panels.openProject(null, { teamId: btn.dataset.team });
    draw();
  } else if (el('[data-open-project]')) {
    panels.openProject(el('[data-open-project]').dataset.openProject);
    draw();
  } else if (el('[data-action="undo"]')) {
    // L'annulation est une écriture : elle prend sa place dans la file.
    undo.trigger();
    draw();
  } else if (el('[data-action="resolve-conflicts"]')) {
    resolveConflictsInScope();
  } else if (el('[data-action="load-chart"]')) {
    openLoadChart();
  }
});

// Résolution automatique des conflits de dépendances, limitée à la team
// affichée (ou au workspace entier en vue globale). Chaque conflit est
// corrigé un par un par la même replanification en cascade que le
// glisser-déposer et le panneau, simulée localement sur le domaine affiché
// (un décalage peut en révéler ou en résoudre d'autres plus loin dans la
// chaîne), puis chaque décalage part dans la file d'écriture. Une seule
// annulation couvre tout le lot, dans l'ordre inverse.
async function resolveConflictsInScope() {
  const fixes = [];
  let simulated = controller.state.snapshot.domain;
  const { fixed, originals, blockedByCycle } = await resolveConflicts(simulated, lastTeamId, async (issueId, dates) => {
    fixes.push({ issueId, dates });
    simulated = previews.reschedule(simulated, issueId, dates);
    return { domain: simulated };
  });
  if (blockedByCycle || fixed === 0) return;
  undo.arm(`${fixed} conflit${fixed > 1 ? 's' : ''} résolu${fixed > 1 ? 's' : ''}`, () => {
    for (const o of [...originals].reverse()) write((api) => api.reschedule(o.issueId, { start: o.start, end: o.end }));
  });
  for (const { issueId, dates } of fixes) write((api) => api.reschedule(issueId, dates));
}

// Glisser-déposer d'une barre : décale début et échéance du même nombre de
// jours calendaires (pas de bornage aux jours ouvrés, comme une saisie
// manuelle de date dans le panneau), puis passe par la même route de
// replanification en cascade que les champs de date du panneau. Le déclic est
// distingué du clic simple par le nombre de jours réellement franchis : sans
// déplacement, aucun appel n'est fait et le clic normal (ouverture du
// panneau) reprend la main.
root.addEventListener('pointerdown', (event) => {
  // Au doigt sur téléphone ou tablette, glisser fait défiler la frise : pas
  // de replanification par accident ; les dates se changent dans le panneau.
  if (event.button !== 0 || (event.pointerType === 'touch' && TOUCH_SCREEN?.matches)) return;
  const card = event.target.closest('.kc');
  if (card) {
    const issue = controller.state.snapshot?.domain.issues.find((i) => i.id === card.dataset.kc);
    if (!issue) return;
    cardDrag = { pointerId: event.pointerId, card, issue, startX: event.clientX, startY: event.clientY, ghost: null, over: null };
    card.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
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
    // Glisser la fin déplace aussi les dépendantes transitives, du même
    // delta, qu'on raccourcisse (elles se rapprochent) ou qu'on allonge
    // (elles reculent) — prévisualisées en mouvement, comme pour le
    // déplacement complet de la barre.
    const rightRows = [...root.querySelectorAll('[data-right] .r.tk')];
    const rowById = new Map(rightRows.map((el) => [el.dataset.t, el]));
    const affectedIds = handle.dataset.edge === 'end' ? transitiveDependents(domain.issues, issue.id) : [];
    const affectedRows = affectedIds.map((id) => rowById.get(id)).filter(Boolean);
    resizeDrag = {
      pointerId: event.pointerId, row, issueId: issue.id, identifier: issue.identifier, edge: handle.dataset.edge,
      issueStatus: issue.status, barColor: sampleBar?.style.backgroundColor || '', isBlocked,
      holidays: new Set(controller.state.planning.holidays.map((h) => h.day)),
      origStart: issue.start, origEnd: issue.end, startX: event.clientX, dayWidth: lastAxis.dayWidth, dayDelta: 0,
      affectedIds, affectedRows,
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
  if (cardDrag && event.pointerId === cardDrag.pointerId) {
    moveCardDrag(event);
    return;
  }
  if (milestoneDrag && event.pointerId === milestoneDrag.pointerId) {
    const dayDelta = dayDeltaFromPixels(event.clientX - milestoneDrag.startX, milestoneDrag.dayWidth);
    const newDate = addDays(milestoneDrag.origDate, dayDelta);
    showDragTip(`<b>${esc(milestoneDrag.name)}</b><br>${shortDay(newDate)}${deltaLabel(dayDelta)}`);
    if (dayDelta === milestoneDrag.dayDelta) return;
    milestoneDrag.dayDelta = dayDelta;
    // Le losange est déjà tourné de 45° par le CSS : remplacer son transform par
    // une simple translation le transformait en carré pendant le glisser.
    const tx = `translateX(${dayDelta * milestoneDrag.dayWidth}px)`;
    for (const p of milestoneDrag.parts) p.style.transform = p.classList.contains('jd') ? `${tx} rotate(45deg)` : tx;
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

// Impression : la frise est redessinée à une largeur de jour pensée pour le
// papier, toutes les lignes dépliées, puis découpée en pages (print.js).
// Branché aussi sur beforeprint pour qu'un Ctrl+P donne le même résultat
// que le bouton.
function preparePrint() {
  if (printLayout || !lastAxis) return;
  const leftPane = root.querySelector('.board:not([hidden]) .pl');
  if (!leftPane) return;
  printLayout = planPrintColumns(lastAxis, printTimelineWidth(leftPane.getBoundingClientRect().width));
  draw();
}

function restoreAfterPrint() {
  if (!printLayout) return;
  printLayout = null;
  clearPrintPages(root.querySelector('.sheet'));
  recenter = true;
  draw();
}

window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', restoreAfterPrint);

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
  write(
    (api) => api.reschedule(issueId, { start, end }),
    `${identifier} déplacée`,
    (api) => api.reschedule(issueId, { start: origStart, end: origEnd }),
  );
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
  write(
    (api) => api.updateMilestone(milestoneId, newDate),
    `Jalon « ${name} » déplacé`,
    (api) => api.updateMilestone(milestoneId, origDate),
  );
}

// Glisser un bord de barre ne modifie que cette date-là pour l'issue
// elle-même (pas de cascade côté serveur, contrairement au déplacement
// complet de la barre) — mais sur le bord de fin, les dépendantes
// transitives sont explicitement décalées du même delta ici (raccourcir
// les rapproche, allonger les repousse), pour rejouer côté serveur ce que
// l'aperçu montrait déjà pendant le glisser. resolveConflictsInScope()
// tourne quand même après coup, en filet de sécurité pour un conflit que
// ce décalage uniforme n'aurait pas suffi à résoudre (sa propre annulation
// indépendante, plutôt qu'une seule annulation combinée plus fragile).
function endResizeDrag(commit) {
  if (!resizeDrag) return;
  root.classList.remove('dragging');
  hideDragTip();
  for (const r of resizeDrag.affectedRows) r.classList.remove('drag-affected');
  const { issueId, identifier, edge, origStart, origEnd, dayDelta, affectedIds } = resizeDrag;
  resizeDrag = null;
  if (dayDelta === 0) return;
  if (!commit) { draw(); return; }
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);
  const field = edge === 'start' ? 'start' : 'end';
  const newValue = addDays(edge === 'start' ? origStart : origEnd, dayDelta);
  const origValue = edge === 'start' ? origStart : origEnd;
  const domain = controller.state.snapshot.domain;
  const shifts = edge === 'end' ? affectedIds
    .map((id) => domain.issues.find((i) => i.id === id))
    .filter((dep) => dep?.start && dep.end)
    .map((dep) => ({
      id: dep.id, origStart: dep.start, origEnd: dep.end,
      newStart: addDays(dep.start, dayDelta), newEnd: addDays(dep.end, dayDelta),
    })) : [];
  undo.arm(`${identifier} : ${edge === 'start' ? 'début' : 'échéance'} modifié`, () => {
    write((api) => api.updateIssue(issueId, { [field]: origValue }));
    for (const s of shifts) write((api) => api.updateIssue(s.id, { start: s.origStart, end: s.origEnd }));
  });
  write((api) => api.updateIssue(issueId, { [field]: newValue }));
  for (const s of shifts) write((api) => api.updateIssue(s.id, { start: s.newStart, end: s.newEnd }));
  // Sur le domaine affiché, qui contient déjà ces décalages (aperçus).
  if (edge === 'end') resolveConflictsInScope();
}

// Glisser une carte du kanban dans une autre colonne change son statut
// Linear (dropState, kanban.js) ; sous quelques pixels, c'est un clic. Les
// colonnes sont relues à chaque mouvement : une actualisation de fond peut
// avoir redessiné le tableau entre-temps.
const CARD_DRAG_SLOP = 5;
const CARD_EDGE_SCROLL = 48;

function moveCardDrag(event) {
  const d = cardDrag;
  const dx = event.clientX - d.startX;
  const dy = event.clientY - d.startY;
  if (!d.ghost) {
    if (Math.hypot(dx, dy) < CARD_DRAG_SLOP) return;
    const rect = d.card.getBoundingClientRect();
    d.ghost = d.card.cloneNode(true);
    d.ghost.classList.add('kc-ghost');
    Object.assign(d.ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
    document.body.appendChild(d.ghost);
    d.card.classList.add('kc-src');
    root.classList.add('dragging');
  }
  d.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(1.5deg)`;
  const strip = root.querySelector('.kb-cols');
  const bounds = strip?.getBoundingClientRect();
  if (bounds?.width) {
    if (event.clientX < bounds.left + CARD_EDGE_SCROLL) strip.scrollLeft -= 14;
    else if (event.clientX > bounds.right - CARD_EDGE_SCROLL) strip.scrollLeft += 14;
  }
  const domain = controller.state.snapshot.domain;
  d.over = null;
  for (const el of root.querySelectorAll('.kcol')) {
    const state = dropState(domain, d.issue, el.dataset.col);
    const r = el.getBoundingClientRect();
    const under = event.clientX >= r.left && event.clientX <= r.right;
    if (under && state) d.over = { el, state };
    const home = el.dataset.col === d.issue.stateId || el.dataset.col === d.issue.status;
    el.classList.toggle('no-drop', !state && !home);
    el.classList.toggle('over', under && Boolean(state));
  }
  showDragTip(`<b>${esc(d.issue.identifier)}</b><br>${d.over ? `→ ${esc(d.over.state.name)}` : '<s>Déposez dans une autre colonne</s>'}`);
}

function endCardDrag(commit) {
  const d = cardDrag;
  if (!d) return;
  cardDrag = null;
  if (!d.ghost) return;
  d.ghost.remove();
  d.card.classList.remove('kc-src');
  root.classList.remove('dragging');
  hideDragTip();
  for (const el of root.querySelectorAll('.kcol')) el.classList.remove('no-drop', 'over');
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 0);
  if (!commit || !d.over) return;
  const { issue } = d;
  const from = issue.stateId;
  const to = d.over.state;
  write(
    (api) => api.updateIssue(issue.id, { stateId: to.id }),
    `${issue.identifier} : ${to.name}`,
    (api) => api.updateIssue(issue.id, { stateId: from }),
  );
}

root.addEventListener('pointerup', () => { endDrag(true); endMilestoneDrag(true); endResizeDrag(true); endCardDrag(true); });
root.addEventListener('pointercancel', () => { endDrag(false); endMilestoneDrag(false); endResizeDrag(false); endCardDrag(false); });

// Curseur de zoom : la frise suit en direct pendant le glissement (une mise à
// jour par image au plus, bandeau conservé), puis le réglage est enregistré
// au relâchement.
let zoomFrame = 0;
function anchorZoom() {
  const pane = root.querySelector('.pr');
  if (pane && lastAxis) zoomAnchor = (pane.scrollLeft + pane.clientWidth / 2) / lastAxis.dayWidth;
}

root.addEventListener('input', (event) => {
  if (!event.target.matches('[data-zoom-range]')) return;
  const dayWidth = Number(event.target.value);
  cancelAnimationFrame(zoomFrame);
  zoomFrame = requestAnimationFrame(() => {
    zoomFrame = 0;
    anchorZoom();
    prefs = { ...prefs, zoom: 'custom', dayWidth };
    keepRail = true;
    try {
      draw();
    } finally {
      keepRail = false;
    }
  });
});

root.addEventListener('change', (event) => {
  if (!event.target.matches('[data-zoom-range]')) return;
  cancelAnimationFrame(zoomFrame);
  zoomFrame = 0;
  anchorZoom();
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

// Bandeau qui s'efface vers le haut quand on descend dans la page et revient
// dès qu'on remonte (comme la barre de Safari), ou quand le pointeur touche
// le haut de la fenêtre, ou quand le clavier y entre. L'état vit sur <html> :
// le bandeau lui-même est reconstruit à chaque draw().
const RAIL_SHOW_ABOVE = 140; // px de défilement sous lesquels il reste affiché
const RAIL_HYSTERESIS = 8; // px de mouvement avant de changer d'avis
let railTucked = false;
let lastScrollY = window.scrollY;
let railFrame = 0;

function setRailTucked(tucked) {
  if (tucked === railTucked) return;
  railTucked = tucked;
  document.documentElement.classList.toggle('rail-tucked', tucked);
}

window.addEventListener('scroll', () => {
  if (railFrame) return;
  railFrame = requestAnimationFrame(() => {
    railFrame = 0;
    const y = window.scrollY;
    const delta = y - lastScrollY;
    if (Math.abs(delta) < RAIL_HYSTERESIS) return;
    lastScrollY = y;
    const busy = root.querySelector('.rail')?.contains(document.activeElement);
    setRailTucked(delta > 0 && y > RAIL_SHOW_ABOVE && !busy);
  });
}, { passive: true });
document.addEventListener('mousemove', (event) => {
  if (railTucked && event.clientY < 18) setRailTucked(false);
}, { passive: true });
document.addEventListener('focusin', (event) => {
  if (railTucked && event.target.closest?.('.rail')) setRailTucked(false);
});

// Carte « reçu de la semaine » (render/weekCard.js) : ouverte d'un clic sur
// une cellule de la bande de charge, posée juste sous la cellule (ou dessus,
// faute de place), hors de #app pour survivre aux redessins. Un second clic
// sur la même cellule, Échap, un clic ailleurs, un défilement ou un
// redimensionnement la ferment.
let weekCard = null;

function closeWeekCard() {
  if (!weekCard) return;
  weekCard.el.remove();
  weekCard.cell.classList.remove('picked');
  weekCard = null;
}

function openWeekCard(cell) {
  const key = cell.dataset.pw;
  const again = weekCard?.key === key;
  closeWeekCard();
  if (again || !controller.state.snapshot || !lastLoad) return;
  const [userId, weekStart] = key.split('|');
  const { domain } = controller.state.snapshot;
  const { planning } = controller.state;
  const user = domain.users.find((u) => u.id === userId);
  const week = lastLoad.people[userId]?.find((w) => w.weekStart === weekStart);
  if (!user || !week) return;
  const el = document.createElement('div');
  el.className = 'weekcard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Charge de ${user.name}`);
  el.innerHTML = weekCardHtml({
    user, users: domain.users, weekStart, capacity: week.capacity,
    rows: weekBreakdown(domain, planning, lastLoad, { userId, weekStart, teamId: lastTeamId }),
    ceiling: planning.settings.loadCeilingPct, projects: domain.projects,
    holidays: new Set(planning.holidays.map((h) => h.day)),
  });
  document.body.appendChild(el);
  // Sous la cellule si la carte y tient, sinon du côté le plus spacieux —
  // jamais sous le bandeau flottant ; la liste des tâches rétrécit au besoin.
  const r = cell.getBoundingClientRect();
  const top0 = (root.querySelector('.rail')?.getBoundingClientRect().bottom ?? 0) + 8;
  const room = { below: window.innerHeight - 12 - (r.bottom + 10), above: r.top - 10 - top0 };
  const below = el.offsetHeight <= room.below || room.below >= room.above;
  const list = el.querySelector('.wc-list');
  const excess = el.offsetHeight - (below ? room.below : room.above);
  if (excess > 0) list.style.maxHeight = `${Math.max(90, list.offsetHeight - excess)}px`;
  const { offsetWidth: w, offsetHeight: h } = el;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
  el.style.left = `${left}px`;
  el.style.top = `${below ? r.bottom + 10 : Math.max(top0, r.top - 10 - h)}px`;
  // L'animation d'ouverture part de la cellule.
  el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : h}px`;
  el.addEventListener('click', (event) => {
    const row = event.target.closest('[data-open]');
    if (!row) return;
    closeWeekCard();
    panels.openIssue(row.dataset.open);
    draw();
  });
  cell.classList.add('picked');
  weekCard = { el, cell, key };
}

document.addEventListener('pointerdown', (event) => {
  if (weekCard && !weekCard.el.contains(event.target) && !event.target.closest?.('[data-pw]')) closeWeekCard();
}, true);
document.addEventListener('scroll', (event) => {
  if (weekCard && !weekCard.el.contains(event.target)) closeWeekCard();
}, true);
window.addEventListener('resize', closeWeekCard);

document.addEventListener('keydown', (event) => {
  easterEgg.key(event);
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-pw]')) {
    event.preventDefault();
    openWeekCard(event.target);
    return;
  }
  if (event.key !== 'Escape') return;
  if (weekCard) {
    closeWeekCard();
    return;
  }
  if (document.querySelector('.chart-overlay')) {
    closeLoadChart();
    return;
  }
  // Modifications non enregistrées : le panneau demande d'abord confirmation.
  panels.requestClose(draw);
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
  write(reco.apply);
}

// La recherche de recommandations (shared/recommendations.js) simule chaque
// candidat sur toutes les semaines en surcharge : sur un périmètre réel, ça
// peut prendre plusieurs centaines de ms, assez pour geler l'affichage si on
// la lance avant que la popup ait eu la moindre chance de se peindre. On
// affiche donc d'abord un état "Calcul…", puis on reporte le calcul lourd
// après la prochaine peinture (setTimeout 0) pour que la popup soit déjà
// visible pendant qu'elle tourne.
function refreshLoadChart() {
  const chart = document.querySelector('.chart-overlay [data-chart]');
  if (!chart || !lastLoad || !lastAxis) return;
  // Déjà rempli (une écriture vient de changer la charge) : on garde le
  // rendu précédent, estompé, plutôt qu'un saut vers « Calcul… ».
  if (chart.childElementCount) chart.classList.add('busy');
  else chart.innerHTML = '<p class="hint">Calcul des recommandations…</p>';
  setTimeout(() => {
    const stillThere = document.querySelector('.chart-overlay [data-chart]');
    if (!stillThere) return;
    stillThere.classList.remove('busy');
    try {
      renderLoadChart(stillThere, {
        domain: controller.state.snapshot.domain, planning: controller.state.planning,
        load: lastLoad, people: lastPeople,
        users: controller.state.snapshot.domain.users,
        ceiling: controller.state.planning.settings.loadCeilingPct,
        teamScoped: lastTeamId !== null, teamId: lastTeamId,
        onApply: applyRecommendation,
      });
    } catch (err) {
      // Ne jamais rester bloqué sur "Calcul…" en silence : si quoi que ce
      // soit casse ici (donnée Linear inattendue...), on le montre plutôt
      // que de laisser la popup indéfiniment vide sans explication.
      console.error('Échec du calcul des recommandations :', err);
      stillThere.innerHTML = `<p class="hint warn">Le calcul des recommandations a échoué : ${esc(err.message)}. Voir la console pour le détail.</p>`;
    }
  }, 0);
}

function openLoadChart() {
  if (document.querySelector('.chart-overlay') || !lastLoad) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay chart-overlay';
  const box = document.createElement('div');
  box.className = 'chartbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'chT');
  box.innerHTML = `<header class="ch-head"><h2 id="chT">Charge et recommandations</h2>
      <button class="x" type="button" data-action="close-chart" aria-label="Fermer">${CLOSE_ICON}</button></header>
    <div class="ch-body" data-chart></div>`;
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
