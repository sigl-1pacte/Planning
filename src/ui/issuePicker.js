import { esc } from './render/format.js';

// Liste de tâches à cocher (« Bloquée par ») avec recherche et filtres. Les
// lignes filtrées sont seulement masquées, jamais retirées : leur case cochée
// compte toujours quand on lit la sélection (`[data-field="deps"] input:checked`).

export const emptyPickerState = () => ({ q: '', team: '', project: '', status: '', only: false });

// Ordre d'affichage des statuts Linear, du début à la fin du cycle de vie.
const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

// Noms réels des statuts Linear (« Backlog », « In Review »…), sans doublon :
// deux teams qui ont chacune « Todo » n'en donnent qu'une entrée.
export function stateNames(states) {
  const rank = (s) => { const i = TYPE_ORDER.indexOf(s.type); return i === -1 ? TYPE_ORDER.length : i; };
  const seen = new Set();
  return [...states]
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position)
    .map((s) => s.name)
    .filter((n) => (seen.has(n) ? false : seen.add(n)));
}

// Minuscules et sans accents : « evaluation » trouve « Évaluation ».
const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchesSearch(haystack, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const target = fold(haystack);
  return words.every((w) => target.includes(w));
}

export function issuePickerHtml({ label, issues, checkedIds, teams, projects, states = [] }) {
  const stateNameOf = new Map(states.map((s) => [s.id, s.name]));
  const opt = (value, text) => `<option value="${esc(value)}">${esc(text)}</option>`;
  return `<div class="fg picker" data-picker>
    <label>${esc(label)}</label>
    <div class="pk-tools">
      <input type="search" data-pk="q" placeholder="Rechercher par identifiant ou titre…" autocomplete="off" aria-label="Rechercher une tâche">
      <div class="pk-filters">
        <select data-pk="team" aria-label="Filtrer par team">${opt('', 'Toutes les teams')}${teams.map((t) => opt(t.id, t.name)).join('')}</select>
        <select data-pk="project" aria-label="Filtrer par projet">${opt('', 'Tous les projets')}${opt('none', 'Sans projet')}${projects.map((p) => opt(p.id, p.name)).join('')}</select>
        <select data-pk="status" aria-label="Filtrer par statut">${opt('', 'Tous les statuts')}${stateNames(states).map((n) => opt(n, n)).join('')}</select>
      </div>
      <label class="pk-only"><input type="checkbox" data-pk="only"> Cochées seulement</label>
      <p class="hint" data-pk-count></p>
    </div>
    <div class="chklist" data-field="deps">
      ${issues.map((x) => `<label class="chkrow" data-team="${esc(x.teamId)}" data-project="${esc(x.projectId ?? 'none')}" data-status="${esc(stateNameOf.get(x.stateId) ?? '')}" data-text="${esc(`${x.identifier} ${x.title}`)}">
        <input type="checkbox" value="${esc(x.id)}"${checkedIds.includes(x.id) ? ' checked' : ''}>
        <span>${esc(x.identifier)} · ${esc(x.title)}</span>
      </label>`).join('')}
      <p class="hint pk-empty" data-pk-empty hidden>Aucune tâche ne correspond.</p>
    </div>
  </div>`;
}

// Branche recherche et filtres ; `state` est mutable et survit aux redessins
// du panneau (chaque coche relit Linear puis redessine), pour ne pas perdre
// la recherche en cours après chaque case cochée.
export function wireIssuePicker(root, state) {
  if (!root) return;
  const control = (name) => root.querySelector(`[data-pk="${name}"]`);
  const rows = [...root.querySelectorAll('.chkrow')];
  const empty = root.querySelector('[data-pk-empty]');
  const count = root.querySelector('[data-pk-count]');

  control('q').value = state.q;
  control('team').value = state.team;
  control('project').value = state.project;
  control('status').value = state.status;
  control('only').checked = state.only;

  function apply() {
    let shown = 0;
    for (const row of rows) {
      const box = row.querySelector('input');
      const visible = (!state.team || row.dataset.team === state.team)
        && (!state.project || row.dataset.project === state.project)
        && (!state.status || row.dataset.status === state.status)
        && (!state.only || box.checked)
        && (!state.q || matchesSearch(row.dataset.text, state.q));
      row.hidden = !visible;
      if (visible) shown += 1;
    }
    empty.hidden = shown > 0 || rows.length === 0;
    const checked = rows.filter((r) => r.querySelector('input').checked).length;
    count.textContent = `${shown} affichée${shown > 1 ? 's' : ''} sur ${rows.length} · ${checked} cochée${checked > 1 ? 's' : ''}`;
  }

  const read = () => {
    state.q = control('q').value;
    state.team = control('team').value;
    state.project = control('project').value;
    state.status = control('status').value;
    state.only = control('only').checked;
    apply();
  };
  root.querySelector('.pk-tools').addEventListener('input', read);
  root.querySelector('.pk-tools').addEventListener('change', read);
  // Cocher/décocher met à jour le compteur et, avec « cochées seulement »,
  // la liste ; le panneau relit ensuite Linear et redessine.
  root.querySelector('.chklist').addEventListener('change', apply);
  // Entrée dans la recherche ne doit rien soumettre.
  control('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  apply();
}
