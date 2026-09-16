import { tint } from './loadRows.js';
import { esc, fr1, shortDay, initials, personColor } from './format.js';
import { personStats } from '../../shared/load.js';

const VB_W = 1000;
const VB_H = 360;
const PAD = { top: 16, right: 16, bottom: 40, left: 46 };

function niceMax(v) {
  if (v <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / magnitude) * magnitude;
}

// Graphique en ligne continue (disponibilité en aire claire, charge en ligne
// avec un point par semaine coloré selon le taux d'occupation) plutôt qu'un
// diagramme en barres — construit en SVG brut plutôt qu'une bibliothèque de
// charting, cohérent avec le reste du rendu de l'app (voir déjà les flèches
// de dépendances dans board.js).
function buildChartSvg(totals, ceiling) {
  const n = totals.length;
  if (!n) return '<p class="hint">Rien à afficher sur ce périmètre.</p>';
  const maxVal = niceMax(Math.max(...totals.map((t) => Math.max(t.hours, Number.isFinite(t.capacity) ? t.capacity : 0))));
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v) => PAD.top + plotH - (Math.min(v, maxVal) / maxVal) * plotH;

  const gridCount = 4;
  const grid = Array.from({ length: gridCount + 1 }, (_, k) => {
    const v = (maxVal / gridCount) * k;
    const gy = y(v);
    return `<line x1="${PAD.left}" y1="${gy}" x2="${VB_W - PAD.right}" y2="${gy}" stroke="var(--line2)" stroke-width="1"/>
      <text x="${PAD.left - 8}" y="${gy}" text-anchor="end" dominant-baseline="middle" class="lcaxis">${Math.round(v)}</text>`;
  }).join('');

  const capPoly = [`${x(0)},${y(0)}`, ...totals.map((t, i) => `${x(i)},${y(t.capacity)}`), `${x(n - 1)},${y(0)}`].join(' ');
  const loadLine = totals.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(t.hours)}`).join(' ');

  const everyLabel = n > 14 ? 2 : 1;
  const labels = totals.map((t, i) => (i % everyLabel === 0
    ? `<text x="${x(i)}" y="${VB_H - PAD.bottom + 16}" text-anchor="middle" class="lcaxis">${esc(shortDay(t.weekStart))}</text>`
    : '')).join('');

  const dots = totals.map((t, i) => {
    const color = tint(t.pct, ceiling).background;
    const label = `${shortDay(t.weekStart)} : ${fr1(t.hours)} h chargées / ${fr1(t.capacity)} h disponibles`;
    return `<circle cx="${x(i)}" cy="${y(t.hours)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.3"><title>${esc(label)}</title></circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" class="lcsvg" preserveAspectRatio="none" role="img">
    ${grid}
    <polygon points="${capPoly}" fill="var(--line2)" opacity=".7"/>
    <path d="${loadLine}" fill="none" stroke="var(--doing)" stroke-width="2.5"/>
    ${dots}
    ${labels}
  </svg>`;
}

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

  container.innerHTML = `
    <h3>Charge ${teamScoped ? 'de la team' : 'du périmètre affiché'} vs disponibilité</h3>
    <div class="lclegend">
      <span><i class="lcsw" style="background:var(--line2)"></i> Disponibilité</span>
      <span><i class="lcsw" style="background:var(--doing)"></i> Charge (point coloré selon le taux d'occupation)</span>
    </div>
    <div class="lchart">${buildChartSvg(totals, ceiling)}</div>
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
