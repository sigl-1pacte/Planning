// src/ui/app.js
import { buildView, rangeFor } from './view.js';
import { computeLoad } from '../shared/load.js';
import { daysBetween } from '../shared/calendar.js';
import { createAxis, dayWidthFor } from './render/layout.js';
import {
  createRowSink, renderAxis, renderGrid, renderMilestones, renderGroups, renderDependencies,
} from './render/board.js';
import { renderLoadRows } from './render/loadRows.js';
import { summarize, renderFacts, renderPeopleTable, renderProjectsTable, renderLegend } from './render/tables.js';
import { renderUnplannedTab } from './render/unplannedTab.js';
import { esc, longDay } from './render/format.js';

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
  }

  root.innerHTML = `
    <div class="rail"><div class="in">
      <div><h1>Planning — ${esc(team ? team.name : 'toutes les teams')}</h1>
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
        <button class="btn" type="button" data-action="refresh">Actualiser</button>
        <button class="btn" type="button" data-action="settings">Réglages</button>
        <button class="btn pri" type="button" data-action="print">Imprimer / PDF</button>
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
      <div class="cols">
        <div class="blk"><h3>Répartition par personne</h3><div class="tbl"><table>
          <thead><tr><th>Personne</th><th class="r">Points</th><th class="r">Heures</th><th class="r">Sem. actives</th><th class="r">Heures / sem.</th><th class="r">Taux moyen</th><th class="r">Pic</th></tr></thead>
          <tbody data-people></tbody></table></div></div>
        <div class="blk"><h3>Projets, avancement et jalons</h3><div class="tbl"><table>
          <thead><tr><th>Projet</th><th>Période</th><th class="r">Tâches</th><th class="r">Points</th><th class="r">Heures</th><th class="r">Terminé</th><th>Jalons</th></tr></thead>
          <tbody data-projects></tbody></table></div></div>
      </div>
      <div class="ft"><span>Planning connecté à Linear · lecture seule</span><span>Édition du ${longDay(today)}</span></div>
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
  const projects = [...new Map(view.groups.flatMap((g) => g.projects.map((p) => [p.project.id, p.project]))).values()];
  renderMilestones(sink, right, projects, axis);
  const { rowY, colorOf } = renderGroups(sink, {
    view, axis, holidays, load, users: domain.users, collapsed: prefs.collapsed, selectedIssueId,
  });
  renderLoadRows(sink, { people: view.people, load, planning, axis, users: domain.users, teamScoped: Boolean(view.teamId) });
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
