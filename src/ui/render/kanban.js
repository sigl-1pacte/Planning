import { STATUS, esc, initials, personColor, shortDay, issueStatus } from './format.js';

// Type de statut Linear → statut de l'application (même table que mapper.js).
const STATUS_OF_TYPE = {
  triage: 'todo', backlog: 'todo', unstarted: 'todo',
  started: 'doing', completed: 'done', canceled: 'canceled',
};
// À faire, en vue globale : « Todo » plutôt que « Backlog » ou « Triage ».
const TYPE_RANK = { unstarted: 0, backlog: 1, triage: 2 };
const NO_PROJECT_COLOR = '#6A6F76';
// Colonnes fermées (terminé, annulé) : les plus récentes seulement, le reste
// à la demande. Elles grossissent sans fin, contrairement aux autres.
export const CLOSED_SHOWN = 20;

const pts = (n) => `${n} pt${n > 1 ? 's' : ''}`;
const byIdentifier = (a, b) => a.identifier.localeCompare(b.identifier, 'fr', { numeric: true });

// Colonnes du tableau. Dans une team : ses statuts Linear, dans l'ordre de
// Linear. En vue globale, les teams n'ont pas les mêmes statuts : on regroupe
// par type, comme les pastilles de la frise.
export function kanbanColumns(domain, { teamId, showCanceled }) {
  if (teamId) {
    return (domain.workflowStates ?? [])
      .filter((s) => s.teamId === teamId && (showCanceled || s.type !== 'canceled'))
      .map((s) => ({ key: s.id, label: s.name, status: STATUS_OF_TYPE[s.type] ?? 'todo', has: (i) => i.stateId === s.id }));
  }
  return ['todo', 'doing', 'done', ...(showCanceled ? ['canceled'] : [])]
    .map((status) => ({ key: status, label: STATUS[status].label, status, has: (i) => i.status === status }));
}

// Statut Linear qu'une tâche prend en tombant dans une colonne, ou null si
// la colonne ne lui en offre aucun (statut d'une autre team, ou team sans
// statut de ce type) ou si elle y est déjà.
export function dropState(domain, issue, columnKey) {
  const states = domain.workflowStates ?? [];
  const own = states.find((s) => s.id === columnKey);
  const target = own
    ? (own.teamId === issue.teamId ? own : null)
    : states
      .filter((s) => s.teamId === issue.teamId && STATUS_OF_TYPE[s.type] === columnKey)
      .sort((a, b) => (TYPE_RANK[a.type] ?? 0) - (TYPE_RANK[b.type] ?? 0) || a.position - b.position)[0] ?? null;
  return target && target.id !== issue.stateId ? target : null;
}

// Fermées : la plus récemment modifiée d'abord. Ouvertes : l'échéance la plus
// proche d'abord, les non planifiées ensuite.
function sortColumn(issues, status) {
  if (status === 'done' || status === 'canceled') {
    return [...issues].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || byIdentifier(a, b));
  }
  return [...issues].sort((a, b) => {
    if (a.end && b.end) return a.end.localeCompare(b.end) || byIdentifier(a, b);
    if (a.end || b.end) return a.end ? -1 : 1;
    return byIdentifier(a, b);
  });
}

function cardHtml(issue, { domain, blocked, selected, showTeam, showState, today }) {
  const status = issueStatus(issue, blocked);
  const project = domain.projects.find((p) => p.id === issue.projectId);
  const team = showTeam ? domain.teams.find((t) => t.id === issue.teamId) : null;
  const state = showState ? domain.workflowStates?.find((s) => s.id === issue.stateId) : null;
  const closed = issue.status === 'done' || issue.status === 'canceled';
  const late = !closed && issue.end && issue.end < today;
  const people = issue.contributorIds.map((id) => domain.users.find((u) => u.id === id)).filter(Boolean);
  const shown = people.slice(0, 3);
  const dates = issue.start
    ? `<span class="kc-dt${late ? ' late' : ''}" title="${late ? 'Échéance dépassée' : 'Début → échéance'}">${shortDay(issue.start)} → ${shortDay(issue.end)}</span>`
    : '<span class="kc-dt none">Non planifiée</span>';
  const who = people.length
    ? `${shown.map((u) => `<i class="kc-av" style="background:${personColor(u.id, domain.users)}" title="${esc(u.name)}">${esc(initials(u))}</i>`).join('')}${people.length > shown.length ? `<i class="kc-av more">+${people.length - shown.length}</i>` : ''}`
    : '<span class="kc-nobody">personne</span>';
  return `<article class="kc${status === 'blocked' ? ' block' : ''}${issue.status === 'canceled' ? ' cx' : ''}${selected ? ' sel' : ''}" data-kc="${esc(issue.id)}" data-open="${esc(issue.id)}"${status === 'blocked' ? ' title="Bloquée par un conflit de dépendance"' : ''}>
    <div class="kc-top"><span class="kc-id">${esc(issue.identifier)}</span>${team ? `<span class="kc-tk">${esc(team.key)}</span>` : ''}${state ? `<span class="kc-st">${esc(state.name)}</span>` : ''}<span class="kc-pts${issue.estimate === null ? ' none' : ''}" title="${issue.estimate === null ? 'Sans estimation' : 'Points'}">${issue.estimate === null ? '?' : pts(issue.estimate)}</span></div>
    <div class="kc-t">${esc(issue.title)}</div>
    ${project ? `<div class="kc-pj"><i class="sw" style="background:${esc(project.color ?? NO_PROJECT_COLOR)}"></i><span>${esc(project.name)}</span></div>` : ''}
    <div class="kc-ft">${dates}<span class="kc-who">${who}</span></div>
  </article>`;
}

// `expanded` : clés des colonnes fermées dépliées en entier (voir main.js).
export function renderKanban(section, { domain, teamId, showCanceled, conflicts, selectedIssueId, today, expanded = new Set(), filter = null }) {
  const columns = kanbanColumns(domain, { teamId, showCanceled });
  const issues = domain.issues.filter((i) => (!teamId || i.teamId === teamId) && (showCanceled || i.status !== 'canceled') && (!filter || filter(i)));
  const blocked = new Set(conflicts.map((c) => c.issueId));
  const ctx = { domain, blocked, showTeam: !teamId, showState: !teamId, today };

  section.innerHTML = `<p class="note">Glissez une carte dans une autre colonne pour changer son statut dans Linear (15 secondes pour annuler). Un clic ouvre la tâche.</p>
    <div class="kb-cols">${columns.map((col) => {
    const all = sortColumn(issues.filter(col.has), col.status);
    const closed = col.status === 'done' || col.status === 'canceled';
    const cards = closed && !expanded.has(col.key) ? all.slice(0, CLOSED_SHOWN) : all;
    const hidden = all.length - cards.length;
    const points = all.reduce((s, i) => s + (i.estimate ?? 0), 0);
    return `<section class="kcol" data-col="${esc(col.key)}">
      <header class="kcol-hd"><i class="kcol-dot" style="background:${STATUS[col.status].color}"></i><h3>${esc(col.label)}</h3>
        <span class="kcol-n">${all.length}</span><span class="kcol-pts">${pts(points)}</span></header>
      <div class="kcol-cards">${cards.map((i) => cardHtml(i, { ...ctx, selected: i.id === selectedIssueId })).join('') || '<p class="kcol-empty">Aucune tâche</p>'}</div>
      ${hidden > 0 ? `<button class="btn ghost kcol-more" type="button" data-kb-more="${esc(col.key)}">Afficher les ${hidden} plus anciennes</button>` : ''}
    </section>`;
  }).join('')}</div>`;
}
