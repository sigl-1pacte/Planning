import { esc, ddmmyyyy } from './format.js';

export function renderUnplannedTab(section, { issues, teams, onPlan }) {
  const teamKey = (id) => teams.find((t) => t.id === id)?.key ?? '—';
  if (!issues.length) {
    section.innerHTML = '<h2>Tâches non planifiées (0)</h2><p class="note">Aucune tâche non planifiée dans ce périmètre.</p>';
    return;
  }
  section.innerHTML = `<h2>Tâches non planifiées (${issues.length})</h2>
    <p class="note">Fixez une date de début et une échéance pour faire apparaître la tâche sur la frise. L'écriture part vers Linear immédiatement, avec 15 secondes pour annuler.</p>
    <div class="tbl"><table>
      <thead><tr><th>Issue</th><th>Titre</th><th>Team</th><th class="r">Points</th><th>Motif</th><th>Début</th><th>Échéance</th><th></th></tr></thead>
      <tbody>${issues.map((i) => `<tr data-t="${esc(i.id)}">
        <td>${esc(i.identifier)}</td>
        <td>${esc(i.title)}</td>
        <td>${esc(teamKey(i.teamId))}</td>
        <td class="r">${i.estimate ?? '—'}</td>
        <td class="why">${esc(i.unplannedReason)}</td>
        <td><div class="dfield"><input type="date" data-start data-issue="${esc(i.id)}"><span class="dovl"></span></div></td>
        <td><div class="dfield"><input type="date" data-end data-issue="${esc(i.id)}"><span class="dovl"></span></div></td>
        <td><button class="btn" type="button" data-action="plan" data-issue="${esc(i.id)}">Planifier</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  section.addEventListener('input', (event) => {
    const target = event.target;
    if (target.type !== 'date') return;
    const overlay = target.nextElementSibling;
    if (overlay?.classList.contains('dovl')) overlay.textContent = target.value ? ddmmyyyy(target.value) : '';
  });

  section.querySelectorAll('[data-action="plan"]').forEach((button) => {
    button.addEventListener('click', () => {
      const issueId = button.dataset.issue;
      const row = button.closest('tr');
      const start = row.querySelector('[data-start]').value;
      const end = row.querySelector('[data-end]').value;
      if (!start || !end) return;
      onPlan(issueId, { start, end });
    });
  });
}
