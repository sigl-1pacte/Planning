import { esc, initials, personColor } from './format.js';
import { personStats } from '../../shared/load.js';
import { buildRecommendations } from '../../shared/recommendations.js';

const CHART_W = 760;
const CHART_H = 220;
const PAD = { l: 46, r: 12, t: 10, b: 22 };

// Graphe agrégé charge (heures réellement posées) vs disponibilité (heures
// de capacité), semaine par semaine, sur le périmètre affiché — plus le
// plafond de charge en pointillés. C'est la seule vue qui montre d'un coup
// d'œil où la charge dépasse la disponibilité, ce que le tableau par
// personne (en dessous) ne montre que ligne par ligne.
export function buildChartSvg(load, people, ceiling) {
  const weeks = load.weeks ?? [];
  if (!weeks.length || !people.length) return '';
  const hoursByWeek = weeks.map((w) => people.reduce((s, p) => s + (load.people[p.id]?.find((r) => r.weekStart === w)?.hours ?? 0), 0));
  const capByWeek = weeks.map((w) => people.reduce((s, p) => s + (load.people[p.id]?.find((r) => r.weekStart === w)?.capacity ?? 0), 0));
  const max = Math.max(1, ...hoursByWeek, ...capByWeek);
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (weeks.length > 1 ? (i / (weeks.length - 1)) * innerW : innerW / 2);
  const y = (v) => PAD.t + innerH - (v / max) * innerH;
  const path = (values) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ceilingValues = capByWeek.map((c) => (c * ceiling) / 100);
  // Points rouges sur les semaines où la charge posée dépasse le plafond :
  // le repère le plus direct pour voir "où ça déborde" sans faire le calcul
  // mentalement à partir des trois courbes.
  const overDots = weeks.map((_, i) => (hoursByWeek[i] > ceilingValues[i]
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(hoursByWeek[i]).toFixed(1)}" r="3.2" fill="#B23A3A"/>` : '')).join('');
  const ticks = weeks.map((w, i) => `<text x="${x(i).toFixed(1)}" y="${CHART_H - 4}" font-size="9" text-anchor="middle" fill="var(--ink3)">${esc(w.slice(5))}</text>`).join('');
  const gridY = [0, 0.5, 1].map((f) => {
    const val = max * f;
    return `<line x1="${PAD.l}" x2="${CHART_W - PAD.r}" y1="${y(val).toFixed(1)}" y2="${y(val).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${PAD.l - 6}" y="${(y(val) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="var(--ink3)">${Math.round(val)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="${CHART_W}" height="${CHART_H}" class="chsvg">
    ${gridY}
    <path d="${path(capByWeek)}" fill="none" stroke="#8CA1B2" stroke-width="1.6"/>
    <path d="${path(ceilingValues)} " fill="none" stroke="#B9700A" stroke-width="1.2" stroke-dasharray="3 3"/>
    <path d="${path(hoursByWeek)}" fill="none" stroke="#2E5F8A" stroke-width="2"/>
    ${overDots}
    ${ticks}
    <g font-size="10">
      <circle cx="${CHART_W - 220}" cy="10" r="4" fill="#2E5F8A"/><text x="${CHART_W - 212}" y="13">Charge posée</text>
      <circle cx="${CHART_W - 130}" cy="10" r="4" fill="#8CA1B2"/><text x="${CHART_W - 122}" y="13">Disponibilité</text>
      <circle cx="${CHART_W - 40}" cy="10" r="4" fill="#B9700A"/><text x="${CHART_W - 32}" y="13">Plafond</text>
    </g>
  </svg>`;
}

const KIND_LABEL = { stretch: 'Étaler', move: 'Décaler', rebalance: 'Rééquilibrer', capacity: 'Capacité' };

// Popup « Charge vs disponibilité » : le graphe d'abord (vue d'ensemble),
// puis des recommandations concrètes et actionnables. Chacune vient d'une
// recherche gloutonne (shared/recommendations.js) qui simule réellement
// l'effet de chaque action candidate sur la charge — pas une heuristique
// non vérifiée — et est déjà classée du levier le moins intrusif (étaler
// une tâche) au plus lourd (ajouter de la capacité, en dernier recours).
export function renderLoadChart(container, { domain, planning, load, people, users, ceiling, teamScoped, teamId, onApply }) {
  const { recommendations, overloadBefore, overloadAfter, stillOverloaded } = buildRecommendations(
    domain, planning, load, ceiling, { teamId },
  );
  container._recommendations = recommendations;

  const status = overloadBefore <= 0.01
    ? '<p class="hint">Rien à signaler : personne ne dépasse le plafond de charge sur ce périmètre.</p>'
    : recommendations.length
      ? `<p class="hint">${Math.round(overloadBefore)} h en surcharge au total sur le périmètre affiché.${stillOverloaded ? ` En appliquant tout ce qui suit, il en resterait ${Math.round(overloadAfter)} h qu'aucune action mesurée ne réduit plus (marges épuisées).` : ' Ces actions suffisent à repasser sous le plafond partout.'}</p>`
      : `<p class="hint warn">${Math.round(overloadBefore)} h en surcharge, mais aucune marge disponible (échéances de projet ou dépendantes) pour la résorber sans capacité supplémentaire ni retard réel.</p>`;

  container.innerHTML = `
    <h3>Charge vs disponibilité ${teamScoped ? 'de la team' : 'sur le périmètre affiché'}</h3>
    <div class="chartwrap">${buildChartSvg(load, people, ceiling) || '<p class="hint">Pas assez de données pour tracer le graphe.</p>'}</div>
    <h3>Recommandations</h3>
    ${status}
    ${recommendations.map((r) => `<div class="recorow">
      <span><span class="kind">${esc(KIND_LABEL[r.kind])}</span> ${esc(r.summary)} <b>(−${r.gainHours} h de surcharge)</b></span>
      <button class="btn" type="button" data-action="apply-reco" data-reco="${r.id}">Appliquer</button>
    </div>`).join('')}
    <h3>Par personne</h3>
    <div class="tbl"><table>
      <thead><tr><th>Personne</th><th class="r">Total</th><th class="r">Pic</th><th class="r">Moyenne</th></tr></thead>
      <tbody>${people.map((p) => {
        const stats = personStats(load.people[p.id]);
        return `<tr>
          <td><span class="ini" style="background-color:${personColor(p.id, users)}">${esc(initials(p))}</span> ${esc(p.name)}</td>
          <td class="r">${Math.round(stats.total)} h</td>
          <td class="r">${Number.isFinite(stats.peakPct) ? `${Math.round(stats.peakPct)} %` : '∞'}</td>
          <td class="r">${Math.round(stats.avgPct)} %</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

  container.querySelectorAll('[data-action="apply-reco"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reco = recommendations.find((r) => r.id === btn.dataset.reco);
      if (!reco) return;
      btn.disabled = true;
      onApply(reco);
    });
  });
}
