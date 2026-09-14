import { esc } from './format.js';

export function renderUnplanned(section, { issues, teams }) {
  if (!issues.length) {
    section.hidden = true;
    section.innerHTML = '';
    return;
  }
  section.hidden = false;
  const teamKey = (id) => teams.find((t) => t.id === id)?.key ?? '—';
  section.innerHTML = `<h3>Tâches non planifiées (${issues.length})</h3>
    <p class="note">Ces issues n'ont pas de date de début ou d'échéance exploitable : elles n'apparaissent pas sur la frise et ne comptent dans aucune charge. Corrigez la ligne « Starting date: JJ/MM/AAAA » ou l'échéance dans Linear ; la saisie depuis ce site arrivera avec l'écriture vers Linear.</p>
    <div class="tbl"><table>
      <thead><tr><th>Issue</th><th>Titre</th><th>Team</th><th class="r">Points</th><th>Motif</th></tr></thead>
      <tbody>${issues.map((i) => `<tr data-t="${esc(i.id)}">
        <td>${esc(i.identifier)}</td>
        <td>${esc(i.title)}</td>
        <td>${esc(teamKey(i.teamId))}</td>
        <td class="r">${i.estimate ?? '—'}</td>
        <td class="why">${esc(i.unplannedReason)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}
