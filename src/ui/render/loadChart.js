import { esc, ddmmyyyy, initials, personColor } from './format.js';
import { personStats } from '../../shared/load.js';
import { suggestReschedules, suggestContributorSwaps } from '../../shared/recommendations.js';

// Popup « Charge vs disponibilité » : mène avec des recommandations
// concrètes (ce qui apporte une vraie valeur au-delà du tableau de charge
// déjà affiché sur le planning), suivies d'un résumé par personne. Les
// suggestions de replanification respectent la marge réelle de chaque
// tâche (chemin critique via shared/recommendations.js : jamais au prix
// d'un dépassement d'échéance de projet ou d'une dépendante).
export function renderLoadChart(container, { domain, load, people, users, ceiling, teamScoped, teamId }) {
  const reschedules = suggestReschedules(domain, load, ceiling, { teamId });
  const swaps = suggestContributorSwaps(domain, load, ceiling, { teamId });

  container.innerHTML = `
    <h3>Recommandations ${teamScoped ? 'pour la team' : 'sur le périmètre affiché'}</h3>
    ${!reschedules.length && !swaps.length
      ? '<p class="hint">Rien à signaler : personne ne dépasse le plafond de charge sur ce périmètre.</p>' : ''}
    ${reschedules.map((r) => `<div class="recorow">
      <span><b>${esc(r.identifier)}</b> · ${esc(r.title)} — la semaine du ${esc(ddmmyyyy(r.weekStart))} est en
        surcharge ; ${esc(r.identifier)} a ${r.slackDays} j de marge avant sa propre échéance (ou celle qu'impose
        une tâche qui en dépend). Décaler du ${esc(ddmmyyyy(r.currentStart))} au ${esc(ddmmyyyy(r.suggestedStart))}
        désengorge cette semaine sans retard réel.</span>
      <button class="btn" type="button" data-action="apply-reschedule"
        data-issue="${esc(r.issueId)}" data-start="${esc(r.suggestedStart)}" data-end="${esc(r.suggestedEnd)}">Appliquer</button>
    </div>`).join('')}
    ${swaps.map((s) => `<div class="recorow">
      <span><b>${esc(s.identifier)}</b> · ${esc(s.title)} — ${esc(s.fromName)} est en surcharge la semaine du
        ${esc(ddmmyyyy(s.weekStart))} ; ${esc(s.toName)}, aussi contributeur·rice de cette tâche, a de la marge
        cette semaine-là. Transférer une part de charge de ${esc(s.fromName)} vers ${esc(s.toName)} sur cette
        tâche (à ajuster dans son panneau, répartition des contributeurs).</span>
    </div>`).join('')}
    <h3>Par personne</h3>
    <div class="tbl"><table>
      <thead><tr><th>Personne</th><th class="r">Total</th><th class="r">Pic</th><th class="r">Moyenne</th></tr></thead>
      <tbody>${people.map((p) => {
        const stats = personStats(load.people[p.id]);
        return `<tr>
          <td><span class="ini" style="background:${personColor(p.id, users)}">${esc(initials(p))}</span> ${esc(p.name)}</td>
          <td class="r">${Math.round(stats.total)} h</td>
          <td class="r">${Number.isFinite(stats.peakPct) ? `${Math.round(stats.peakPct)} %` : '∞'}</td>
          <td class="r">${Math.round(stats.avgPct)} %</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
