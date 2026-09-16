import { tint } from './loadRows.js';
import { esc, fr1, shortDay, initials, personColor } from './format.js';
import { personStats } from '../../shared/load.js';

// Graphique agrégé (charge vs disponibilité, semaine par semaine, sur le
// périmètre affiché) suivi d'un résumé par personne — construit avec de
// simples barres en div plutôt qu'une bibliothèque de graphes, cohérent
// avec le reste du rendu de l'app (pas de dépendance de charting).
export function renderLoadChart(container, { load, people, users, ceiling, teamScoped }) {
  const weekStarts = people.length ? load.people[people[0].id].map((w) => w.weekStart) : [];
  const totals = weekStarts.map((weekStart, i) => {
    let hours = 0;
    let capacity = 0;
    for (const p of people) {
      const w = load.people[p.id][i];
      hours += w.hours;
      capacity += w.capacity;
    }
    const pct = capacity > 0 ? (hours / capacity) * 100 : (hours > 0.01 ? Infinity : 0);
    return { weekStart, hours, capacity, pct };
  });
  const maxVal = Math.max(1, ...totals.map((t) => Math.max(t.hours, t.capacity)));

  container.innerHTML = `
    <h3>Charge ${teamScoped ? 'de la team' : 'du périmètre affiché'} vs disponibilité</h3>
    <p class="hint">Chaque semaine : barre claire = disponibilité totale, barre colorée = charge prévue (couleur selon le taux d'occupation).</p>
    <div class="lchart">
      ${totals.map((t) => {
        const capH = Math.round((t.capacity / maxVal) * 100);
        const loadH = Math.round((Number.isFinite(t.hours) ? t.hours : maxVal) / maxVal * 100);
        const color = tint(t.pct, ceiling).background;
        const label = `${shortDay(t.weekStart)} : ${fr1(t.hours)} h chargées / ${fr1(t.capacity)} h disponibles`;
        return `<div class="lcbar" title="${esc(label)}">
          <div class="lccap" style="height:${capH}%"></div>
          <div class="lcload" style="height:${Math.min(100, loadH)}%;background:${color}"></div>
          <span class="lcx">${shortDay(t.weekStart)}</span>
        </div>`;
      }).join('')}
    </div>
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
