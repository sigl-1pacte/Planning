import { esc } from './format.js';
import { DUE, PRESETS, describeFilter, isEmptyFilter, normalizeFilter, sameFilter } from '../../shared/filters.js';

const CARET = '<svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';

function dropdown(key, label, options, selected) {
  const chosen = options.filter((o) => selected.includes(o.id));
  const summary = chosen.length === 1 ? chosen[0].label : chosen.length ? String(chosen.length) : '';
  return `<details class="fb-dd" data-fb-dd="${key}">
    <summary class="fb-pick${chosen.length ? ' set' : ''}">${label}${summary ? ` · <b>${esc(summary)}</b>` : ''}${CARET}</summary>
    <div class="fb-menu">${options.map((o) => `<label class="fb-opt"><input type="checkbox" data-fb-${key} value="${esc(o.id)}"${selected.includes(o.id) ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>
  </details>`;
}

// Barre de filtres et de vues, au-dessus de la frise et du kanban. Tout y est
// décrit par des data-* ; les réactions sont dans main.js.
//  - views : vues de la personne connectée (null tant qu'elles ne sont pas lues) ;
//  - viewsError : vues personnelles indisponibles (les vues par défaut restent) ;
//  - naming : saisie du nom d'une nouvelle vue en cours ;
//  - pendingDelete : id de la vue dont on confirme la suppression ;
//  - matches : nombre de tâches retenues par le filtre (null sans filtre).
export function renderFilterBar(el, { domain, teamId, filter, viewId, views, viewsError, me, naming, pendingDelete, matches = null }) {
  const f = normalizeFilter(filter);
  const own = views ?? [];
  const all = [...PRESETS, ...own];
  const empty = isEmptyFilter(f);
  const active = all.find((v) => v.id === viewId) ?? all.find((v) => sameFilter(v.filter, f)) ?? null;
  const modified = Boolean(active) && !sameFilter(active.filter, f);
  const ownActive = own.find((v) => v.id === active?.id) ?? null;

  const scopeIssues = domain.issues.filter((i) => !teamId || i.teamId === teamId);
  const team = teamId ? domain.teams.find((t) => t.id === teamId) : null;
  const peopleIds = new Set([...(team?.memberIds ?? domain.teams.flatMap((t) => t.memberIds)), ...scopeIssues.flatMap((i) => i.contributorIds)]);
  const meUser = domain.users.find((u) => u.id === me);
  const people = [
    ...(me ? [{ id: 'me', label: `Moi${meUser ? ` (${meUser.name})` : ''}` }] : []),
    { id: 'nobody', label: 'Personne (sans contributeur)' },
    ...domain.users.filter((u) => peopleIds.has(u.id) && u.id !== me).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((u) => ({ id: u.id, label: u.name })),
  ];
  const projects = [
    ...domain.projects.filter((p) => !teamId || p.teamIds.includes(teamId)).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => ({ id: p.id, label: p.name })),
    { id: 'none', label: 'Sans projet' },
  ];

  const chip = (v) => {
    const needsMe = v.filter.people.includes('me') && !me;
    const on = v.id === active?.id;
    return `<button type="button" class="fb-chip${on ? ' on' : ''}${on && modified ? ' mod' : ''}" data-view="${esc(v.id)}"${needsMe ? ' disabled title="Votre identité Linear n\'a pas pu être lue"' : ''}${on && modified ? ' title="Filtres modifiés depuis cette vue"' : ''}>${esc(v.name)}</button>`;
  };
  const ownChip = (v) => (v.id === pendingDelete
    ? `<span class="fb-own confirm">Supprimer « ${esc(v.name)} » ?
        <button type="button" class="btn danger" data-view-del-ok="${esc(v.id)}">Supprimer</button>
        <button type="button" class="btn ghost" data-view-del-no>Annuler</button></span>`
    : `<span class="fb-own">${chip(v)}<button type="button" class="fb-x" data-view-del="${esc(v.id)}" aria-label="Supprimer la vue « ${esc(v.name)} »" title="Supprimer la vue">×</button></span>`);

  let save = '';
  if (naming) {
    save = `<span class="fb-save"><input class="fb-name" data-fb-name maxlength="60" placeholder="Nom de la vue" aria-label="Nom de la vue">
      <button type="button" class="btn pri" data-fb-save-ok>Enregistrer</button>
      <button type="button" class="btn ghost" data-fb-save-no>Annuler</button></span>`;
  } else if (viewsError) {
    save = `<span class="fb-note" title="${esc(viewsError)}">Vues personnelles indisponibles</span>`;
  } else if (views && ownActive && modified) {
    save = `<span class="fb-save"><button type="button" class="btn" data-fb-update>Mettre à jour « ${esc(ownActive.name)} »</button>
      <button type="button" class="btn ghost" data-fb-save>Nouvelle vue…</button></span>`;
  } else if (views && !empty && (!active || modified)) {
    save = '<span class="fb-save"><button type="button" class="btn" data-fb-save>Enregistrer comme vue…</button></span>';
  }

  el.innerHTML = `
    <div class="fb-views" role="group" aria-label="Vues">
      <button type="button" class="fb-chip${empty && !active ? ' on' : ''}" data-view="">Toutes les tâches</button>
      ${PRESETS.map(chip).join('')}
      ${own.length ? `<span class="fb-sep" aria-hidden="true"></span>${own.map(ownChip).join('')}` : ''}
    </div>
    <div class="fb-row">
      ${dropdown('people', 'Personne', people, f.people)}
      ${dropdown('projects', 'Projet', projects, f.projects)}
      <select class="fb-pick${f.due ? ' set' : ''}" data-fb-due aria-label="Échéance">
        <option value="">Toutes les échéances</option>
        ${DUE.map((d) => `<option value="${d.key}"${f.due === d.key ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
      </select>
      <input type="search" class="fb-q" data-fb-q value="${esc(f.q)}" placeholder="Rechercher une tâche" aria-label="Rechercher par identifiant ou titre">
      ${matches === null ? '' : `<span class="fb-count${matches ? '' : ' none'}">${matches ? `${matches} tâche${matches > 1 ? 's' : ''}` : 'Aucune tâche ne correspond'}</span>`}
      ${empty ? '' : '<button type="button" class="btn ghost" data-fb-clear>Effacer les filtres</button>'}
      ${save}
    </div>
    ${empty ? '' : `<p class="fb-print">Vue filtrée${active && !modified ? ` « ${esc(active.name)} »` : ''} : ${esc(describeFilter(f, domain))}.</p>`}`;
}
