// src/ui/app.js
import { buildView, rangeFor } from './view.js';
import { computeLoad } from '../shared/load.js';
import { daysBetween } from '../shared/calendar.js';
import { createAxis, dayWidthFor } from './render/layout.js';
import {
  createRowSink, renderAxis, renderGrid, renderGroups, renderDependencies,
} from './render/board.js';
import { renderLoadRows } from './render/loadRows.js';
import { buildChartSvg } from './render/loadChart.js';
import { summarize, renderFacts, renderPeopleTable, renderProjectsTable, renderLegend } from './render/tables.js';
import { renderUnplannedTab } from './render/unplannedTab.js';
import { esc, longDay } from './render/format.js';
import { scopedConflicts } from './conflictResolution.js';

const zoomButton = (prefs, zoom, label) => `<button type="button" data-zoom="${zoom}" class="${prefs.zoom === zoom ? 'on' : ''}">${label}</button>`;

export function renderLoadError(root, message) {
  root.innerHTML = `<section class="sheet"><div class="banner err">${esc(message)}</div><p class="note">Nouvelle tentative automatique toutes les 30 secondes.</p></section>`;
}

export function renderApp(root, { state, route, prefs, selectedIssueId, today, viewportWidth, onPlan }) {
  const { snapshot, planning } = state;
  const domain = snapshot.domain;
  const view = buildView(domain, { route, showCanceled: prefs.showCanceled });
  const range = rangeFor(domain, view, today);
  const days = daysBetween(range.from, range.to) + 1;
  const axis = createAxis(range, dayWidthFor(prefs.zoom, { viewportWidth, days, customWidth: prefs.dayWidth }));
  const load = computeLoad(domain, planning, { range, teamId: view.teamId });
  const holidays = new Set(planning.holidays.map((h) => h.day));
  const team = view.teamId ? domain.teams.find((t) => t.id === view.teamId) : null;

  const banners = [];
  if (snapshot.stale) {
    banners.push(`<div class="banner">Linear n'a pas pu être interrogé (${esc(snapshot.lastError)}) : données du ${esc(new Date(snapshot.fetchedAt).toLocaleString('fr-FR'))}.</div>`);
  }
  if (state.error) banners.push(`<div class="banner err">${esc(state.error)}</div>`);
  if (view.notFound) banners.push(`<div class="banner err">Team « ${esc(route.teamKey)} » introuvable dans le workspace.</div>`);
  if (view.cycles.length) {
    const ident = (id) => domain.issues.find((i) => i.id === id)?.identifier ?? id;
    banners.push(`<div class="banner">Dépendances circulaires : ${view.cycles.map((c) => esc([...c, c[0]].map(ident).join(' → '))).join(' ; ')}</div>`);
  } else {
    const conflicts = scopedConflicts(domain, view.teamId);
    if (conflicts.length) {
      banners.push(`<div class="banner act"><span>${conflicts.length} conflit${conflicts.length > 1 ? 's' : ''} de dépendances${team ? ` pour ${esc(team.name)}` : ''} : une dépendante démarre avant la fin de sa bloqueuse (terminées et annulées exclues).</span>
        <button class="btn" type="button" data-action="resolve-conflicts">Résoudre automatiquement</button></div>`);
    }
  }

  root.innerHTML = `
    <div class="rail"><div class="in">
      <div><h1>1PACTE Planning Dashboard — ${esc(team ? team.name : 'toutes les teams')}</h1>
        <div class="sb">${longDay(axis.from)} → ${longDay(axis.to)}</div></div>
      <nav class="nav">
        <a href="#/" class="${route.view === 'global' ? 'on' : ''}">Vue globale</a>
        ${domain.teams.map((t) => `<a href="#/team/${encodeURIComponent(t.key)}" class="${team?.id === t.id ? 'on' : ''}">${esc(t.key)}</a>`).join('')}
        <a href="#/unplanned" class="${route.tab === 'unplanned' ? 'on' : ''}">Non planifiées (${domain.issues.filter((i) => !i.start).length})</a>
      </nav>
      <div class="tools">
        <div class="zoom">
          ${zoomButton(prefs, 'all', 'Tout')}${zoomButton(prefs, 'quarter', 'Trimestre')}${zoomButton(prefs, 'month', 'Mois')}
          <input type="range" data-zoom-range min="2" max="60" step="1" value="${Math.round(axis.dayWidth)}" aria-label="Largeur d'un jour">
        </div>
        <button class="btn accent" type="button" data-action="load-chart">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 13.5V2M2 13.5h12"/><path d="M4.5 11 8 7l2 2 3.5-4"/></svg>
          Recommandations</button>
        <button class="btn" type="button" data-action="refresh">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.66"/><path d="M13 2.5V6h-3.5"/></svg>
          Actualiser</button>
        <button class="btn" type="button" data-action="settings">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6"/></svg>
          Réglages</button>
        <button class="btn pri" type="button" data-action="print">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6V2h7v4M4.5 12.5h7V9h-7z"/><rect x="2" y="6" width="12" height="5.5" rx="1"/></svg>
          Imprimer / PDF</button>
      </div>
    </div></div>
    <section class="sheet">
      <div class="hd">
        <div><h2>Planning, dépendances et charge prévisionnelle</h2>
          <div class="s cd">Données Linear du ${esc(new Date(snapshot.fetchedAt).toLocaleString('fr-FR'))}</div></div>
        <div class="facts"></div>
      </div>
      ${banners.join('')}
      <div class="board">
        <div class="pl">
          <div class="ax"><span>Statut · tâche · équipe</span><span style="margin-left:auto">pts · début · fin</span></div>
          <div data-left></div>
        </div>
        <div class="pr"><div class="canvas" style="width:${axis.width}px">
          <div class="ax" data-axis></div>
          <div class="rows" data-right><div class="gr" data-grid></div><svg class="dep" data-deps></svg></div>
        </div></div>
      </div>
      <div class="lg"></div>
      <section class="unp"></section>
      <section class="slide-chart print-only">
        <h2>Charge vs disponibilité ${esc(team ? `— ${team.name}` : '— toutes les teams')}</h2>
        ${buildChartSvg(load, view.people, planning.settings.loadCeilingPct) || ''}
      </section>
      <div class="cols page-slide">
        <div class="blk"><h3>Répartition par personne</h3><div class="tbl"><table>
          <thead><tr><th>Personne</th><th class="r">Points</th><th class="r">Heures</th><th class="r">Sem. actives</th><th class="r">Heures / sem.</th><th class="r">Taux moyen</th><th class="r">Pic</th></tr></thead>
          <tbody data-people></tbody></table></div></div>
        <div class="blk"><h3>Projets, avancement et jalons</h3><div class="tbl"><table>
          <thead><tr><th>Projet</th><th>Période</th><th class="r">Tâches</th><th class="r">Points</th><th class="r">Heures</th><th class="r">Terminé</th><th>Jalons</th></tr></thead>
          <tbody data-projects></tbody></table></div></div>
      </div>
      <div class="ft"><span>Planning connecté à Linear · lecture et écriture</span><span>Édition du ${longDay(today)}</span></div>
    </section>`;

  if (route.tab === 'unplanned') {
    root.querySelector('.board').hidden = true;
    root.querySelector('.cols').hidden = true;
    root.querySelector('.unp').hidden = false;
    renderUnplannedTab(root.querySelector('.unp'), {
      issues: view.unplanned, teams: domain.teams, onPlan,
    });
    return { view, axis, load };
  }

  const left = root.querySelector('[data-left]');
  const right = root.querySelector('[data-right]');
  const sink = createRowSink(left, right);
  const { rowY, colorOf } = renderGroups(sink, {
    view, axis, holidays, load, users: domain.users, collapsed: prefs.collapsed, selectedIssueId,
    states: domain.workflowStates,
  });
  renderLoadRows(sink, { people: view.people, load, planning, axis, users: domain.users, teamScoped: Boolean(view.teamId), mode: prefs.loadMode });
  renderGrid(root.querySelector('[data-grid]'), axis, holidays, today, sink.top);
  renderDependencies(root.querySelector('[data-deps]'), { rowY, colorOf, issues: domain.issues, conflicts: view.conflicts, axis, height: sink.top });
  renderAxis(root.querySelector('[data-axis]'), axis, today);

  const summaryContext = { view, load, planning, domain };
  renderFacts(root.querySelector('.facts'), summarize(summaryContext));
  renderLegend(root.querySelector('.lg'), summaryContext);
  renderPeopleTable(root.querySelector('[data-people]'), summaryContext);
  renderProjectsTable(root.querySelector('[data-projects]'), summaryContext);

  return { view, axis, load };
}
