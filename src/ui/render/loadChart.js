import { esc, initials, personColor, fr1, longDay } from './format.js';
import { tint } from './loadRows.js';
import { personStats } from '../../shared/load.js';
import { buildRecommendations } from '../../shared/recommendations.js';

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const weekLabel = (iso) => `${Number(iso.slice(8))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
const ddmm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
const hoursText = (h) => `${Math.round(h)} h`;
const pctText = (pct) => (Number.isFinite(pct) ? `${Math.round(pct)} %` : '∞');
// Au-dessus du plafond : même règle que la recherche de recommandations,
// sans compter une semaine vide (0 h sur 0 h de capacité).
const isOver = (row, ceiling) => row && row.hours > 0.01 && (!Number.isFinite(row.pct) || row.pct > ceiling);

// Semaine par semaine, sur le périmètre affiché : heures posées, capacité,
// plafond, et qui le dépasse. Le total d'équipe peut rester sous le plafond
// alors qu'une personne est à 200 % : `over` garde cette information, que le
// graphe montre en bande de fond.
function aggregate(load, people, ceiling) {
  return (load.weeks ?? []).map((weekStart) => {
    let hours = 0;
    let capacity = 0;
    const over = [];
    for (const p of people) {
      const row = load.people[p.id]?.find((r) => r.weekStart === weekStart);
      if (!row) continue;
      hours += row.hours;
      capacity += row.capacity;
      if (isOver(row, ceiling)) over.push(p);
    }
    return { weekStart, hours, capacity, ceil: (capacity * ceiling) / 100, over };
  });
}

// Graduations rondes (1, 2, 2,5 ou 5 × 10^n), quatre intervalles environ.
function niceTicks(max) {
  const raw = Math.max(1, max) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw);
  const top = Math.ceil(Math.max(1, max) / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  return ticks;
}

function chartModel(load, people, ceiling, { width = 760, height = 240, legend = true } = {}) {
  const weeks = aggregate(load, people, ceiling);
  if (!weeks.length || !people.length) return null;
  const pad = { l: 44, r: 18, t: legend ? 34 : 14, b: 28 };
  const ticks = niceTicks(Math.max(...weeks.flatMap((w) => [w.hours, w.capacity])));
  const top = ticks.at(-1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = weeks.length;
  const step = n > 1 ? innerW / (n - 1) : innerW;
  const x = (i) => pad.l + (n > 1 ? i * step : innerW / 2);
  const y = (v) => pad.t + innerH - (v / top) * innerH;
  return { weeks, width, height, pad, ticks, innerW, innerH, step, x, y, legend };
}

const LEGEND = [
  { key: 'load', label: 'Charge posée' },
  { key: 'cap', label: 'Disponibilité' },
  { key: 'ceil', label: 'Plafond' },
  { key: 'over', label: 'Quelqu\'un au-dessus du plafond' },
];

function svgFromModel(m) {
  const { weeks, width, height, pad, ticks, x, y, step } = m;
  const f = (v) => v.toFixed(1);
  const line = (key) => weeks.map((w, i) => `${i ? 'L' : 'M'}${f(x(i))},${f(y(w[key]))}`).join(' ');
  const base = y(0);
  const area = `${line('hours')} L${f(x(weeks.length - 1))},${f(base)} L${f(x(0))},${f(base)} Z`;
  const half = weeks.length > 1 ? step / 2 : m.innerW / 2;
  const left = pad.l;
  const right = width - pad.r;
  const bands = weeks.map((w, i) => {
    if (!w.over.length) return '';
    const x0 = Math.max(left, x(i) - half);
    const x1 = Math.min(right, x(i) + half);
    return `<rect x="${f(x0)}" y="${pad.t}" width="${f(x1 - x0)}" height="${f(base - pad.t)}" class="ch-band"/>`;
  }).join('');
  const grid = ticks.map((v) => `<line x1="${left}" x2="${right}" y1="${f(y(v))}" y2="${f(y(v))}" class="ch-grid"/>
    <text x="${left - 8}" y="${f(y(v) + 3.5)}" text-anchor="end" class="ch-tick">${v}</text>`).join('');
  // Une étiquette de semaine sur k, pour qu'elles ne se chevauchent jamais.
  const every = Math.max(1, Math.ceil(52 / Math.max(1, step)));
  const xLabels = weeks.map((w, i) => (i % every ? '' : `<text x="${f(x(i))}" y="${height - 8}" text-anchor="middle" class="ch-tick">${esc(weekLabel(w.weekStart))}</text>`)).join('');
  const dots = weeks.map((w, i) => (w.hours > w.ceil + 0.01
    ? `<circle cx="${f(x(i))}" cy="${f(y(w.hours))}" r="4" class="ch-dot"/>` : '')).join('');
  let legend = '';
  if (m.legend) {
    let lx = left;
    legend = `<g class="ch-legend">${LEGEND.map(({ key, label }) => {
      const key0 = lx;
      lx += 26 + label.length * 5.6 + 18;
      const mark = key === 'over'
        ? `<rect x="${key0}" y="7" width="16" height="10" rx="2" class="ch-band"/>`
        : `<line x1="${key0}" x2="${key0 + 16}" y1="12" y2="12" class="ch-${key}"/>`;
      return `${mark}<text x="${key0 + 22}" y="15.5" class="ch-tick">${esc(label)}</text>`;
    }).join('')}</g>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="chsvg" role="img"
    aria-label="Charge posée, disponibilité et plafond de l'équipe, semaine par semaine">
    ${legend}${bands}${grid}
    <line x1="${left}" x2="${right}" y1="${f(base)}" y2="${f(base)}" class="ch-axis"/>
    <path d="${area}" class="ch-area"/>
    <path d="${line('capacity')}" class="ch-cap"/>
    <path d="${line('ceil')}" class="ch-ceil"/>
    <path d="${line('hours')}" class="ch-load"/>
    ${dots}${xLabels}
    <line class="ch-cross" x1="0" x2="0" y1="${pad.t}" y2="${f(base)}" visibility="hidden"/>
  </svg>`;
}

// Graphe agrégé charge (heures réellement posées) vs disponibilité (heures
// de capacité), semaine par semaine, sur le périmètre affiché, plus le
// plafond de charge en pointillés et, en fond, les semaines où au moins une
// personne dépasse ce plafond. Sert aussi à l'impression (légende incluse).
export function buildChartSvg(load, people, ceiling, opts) {
  const m = chartModel(load, people, ceiling, opts);
  return m ? svgFromModel(m) : '';
}

const KIND = {
  stretch: { label: 'Étaler', icon: '<path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3"/>' },
  move: { label: 'Décaler', icon: '<path d="M2 8h11M10 5l3 3-3 3"/>' },
  rebalance: { label: 'Rééquilibrer', icon: '<path d="M3 5h10M10 2l3 3-3 3M13 11H3M6 8l-3 3 3 3"/>' },
  capacity: { label: 'Capacité', icon: '<path d="M8 3v10M3 8h10"/>' },
};
const kindIcon = (kind) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${KIND[kind].icon}</svg>`;

function tile(label, value, note, tone = '') {
  return `<div class="ch-tile${tone ? ` ${tone}` : ''}"><span>${esc(label)}</span><b>${esc(value)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
}

function heatmap(load, people, users, ceiling) {
  const weeks = load.weeks ?? [];
  const head = `<div class="hm-row hm-head" role="row">
      <span class="hm-who" role="columnheader">Personne</span>
      ${weeks.map((w) => `<span class="hm-wk" role="columnheader" title="Semaine du ${esc(longDay(w))}">${ddmm(w)}</span>`).join('')}
      <span class="hm-n" role="columnheader">Total</span><span class="hm-n" role="columnheader">Pic</span><span class="hm-n" role="columnheader">Moy.</span>
    </div>`;
  const rows = people.map((p) => {
    const stats = personStats(load.people[p.id]);
    const cells = weeks.map((w) => {
      const row = load.people[p.id]?.find((r) => r.weekStart === w);
      if (!row || row.hours <= 0.01) {
        return `<span class="hm-c z" role="cell" tabindex="-1" data-tip-person="${esc(p.id)}" data-tip-week="${w}"></span>`;
      }
      const t = tint(row.pct, ceiling);
      return `<span class="hm-c${isOver(row, ceiling) ? ' over' : ''}" role="cell" tabindex="0" data-tip-person="${esc(p.id)}" data-tip-week="${w}"
        style="background-color:${t.background};color:${t.color}">${Number.isFinite(row.pct) ? Math.round(row.pct) : '∞'}</span>`;
    }).join('');
    return `<div class="hm-row" role="row">
      <span class="hm-who" role="rowheader"><span class="ini" style="background-color:${personColor(p.id, users)}">${esc(initials(p))}</span><span>${esc(p.name)}</span></span>
      ${cells}
      <span class="hm-n" role="cell">${hoursText(stats.total)}</span>
      <span class="hm-n${stats.peakPct > ceiling ? ' hot' : ''}" role="cell">${pctText(stats.peakPct)}</span>
      <span class="hm-n" role="cell">${Math.round(stats.avgPct)} %</span>
    </div>`;
  }).join('');
  return `<div class="hm-scroll"><div class="hm" role="table" aria-label="Taux de charge par personne et par semaine" style="--weeks:${weeks.length}">${head}${rows}</div></div>
    <div class="lg hm-lg">
      <span><i style="background:var(--load-1)"></i>charge légère</span>
      <span><i style="background:var(--load-2)"></i>rythme normal</span>
      <span><i style="background:var(--load-3)"></i>au-dessus de ${ceiling} %</span>
      <span><i style="background:var(--load-4)"></i>surcharge</span>
      <span class="hm-unit">Chiffres : charge en % de la disponibilité de la semaine</span>
    </div>`;
}

function recoList(recommendations, overloadBefore) {
  return `<ol class="recos">${recommendations.map((r, k) => {
    const share = overloadBefore > 0 ? Math.min(100, (r.gainHours / overloadBefore) * 100) : 0;
    return `<li class="reco recorow">
      <span class="reco-n">${k + 1}</span>
      <div class="reco-main">
        <span class="reco-kind k-${r.kind}">${kindIcon(r.kind)}${esc(KIND[r.kind].label)}</span>
        <b>${esc(r.target ?? r.summary)}</b>
        ${r.detail ? `<span class="reco-detail">${esc(r.detail)}</span>` : ''}
      </div>
      <div class="reco-gain" title="${esc(`${fr1(r.gainHours)} h de surcharge en moins`)}">
        <b>−${Math.round(r.gainHours)} h</b><span>de surcharge</span>
        <i class="reco-meter"><i style="width:${share.toFixed(1)}%"></i></i>
      </div>
      <button class="btn" type="button" data-action="apply-reco" data-reco="${r.id}">Appliquer</button>
    </li>`;
  }).join('')}</ol>`;
}

// Infobulle unique de la popup (graphe et carte de chaleur) : construite en
// DOM (textContent), jamais en innerHTML — les noms viennent de Linear.
function tooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'ch-tip';
  tip.hidden = true;
  host.appendChild(tip);
  return {
    show(title, rows, anchor) {
      tip.replaceChildren();
      const h = document.createElement('div');
      h.className = 'ch-tip-h';
      h.textContent = title;
      tip.appendChild(h);
      for (const { value, label, key } of rows) {
        const row = document.createElement('div');
        row.className = 'ch-tip-r';
        if (key) {
          const k = document.createElement('i');
          k.className = `ch-key ch-key-${key}`;
          row.appendChild(k);
        }
        const b = document.createElement('b');
        b.textContent = value;
        const s = document.createElement('span');
        s.textContent = label;
        row.append(b, s);
        tip.appendChild(row);
      }
      tip.hidden = false;
      const hostBox = host.getBoundingClientRect();
      const left = anchor.x - hostBox.left;
      const flip = left + tip.offsetWidth + 16 > hostBox.width;
      tip.style.left = `${flip ? left - tip.offsetWidth - 12 : left + 12}px`;
      tip.style.top = `${Math.max(4, anchor.y - hostBox.top - tip.offsetHeight / 2)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

function wireChartHover(wrap, m, ceiling) {
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const cross = svg.querySelector('.ch-cross');
  const tip = tooltip(wrap);
  const move = (event) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const px = ((event.clientX - box.left) / box.width) * m.width;
    const i = Math.max(0, Math.min(m.weeks.length - 1, Math.round((px - m.pad.l) / (m.weeks.length > 1 ? m.step : 1))));
    const w = m.weeks[i];
    const cx = m.x(i);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    const rows = [
      { value: hoursText(w.hours), label: 'charge posée', key: 'load' },
      { value: hoursText(w.capacity), label: 'disponibles', key: 'cap' },
      { value: hoursText(w.ceil), label: `plafond (${ceiling} %)`, key: 'ceil' },
    ];
    if (w.over.length) rows.push({ value: w.over.map((p) => p.name).join(', '), label: 'au-dessus du plafond', key: 'over' });
    tip.show(`Semaine du ${longDay(w.weekStart)}`, rows, { x: box.left + (cx / m.width) * box.width, y: event.clientY });
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hide();
  });
}

function wireHeatHover(scroll, load, people, ceiling) {
  const tip = tooltip(scroll.parentElement);
  const show = (cell) => {
    const person = people.find((p) => p.id === cell.dataset.tipPerson);
    const row = load.people[cell.dataset.tipPerson]?.find((r) => r.weekStart === cell.dataset.tipWeek);
    if (!person || !row) return;
    const box = cell.getBoundingClientRect();
    tip.show(`${person.name} · semaine du ${longDay(row.weekStart)}`, [
      { value: hoursText(row.hours), label: 'posées' },
      { value: hoursText(row.capacity), label: 'disponibles' },
      { value: pctText(row.pct), label: isOver(row, ceiling) ? `au-dessus du plafond (${ceiling} %)` : 'de la disponibilité' },
    ], { x: box.right, y: box.top + box.height / 2 });
  };
  const target = (event) => event.target.closest?.('[data-tip-week]');
  scroll.addEventListener('pointerover', (event) => { const c = target(event); if (c) show(c); });
  scroll.addEventListener('focusin', (event) => { const c = target(event); if (c) show(c); });
  scroll.addEventListener('pointerleave', () => tip.hide());
  scroll.addEventListener('focusout', () => tip.hide());
}

// Popup « Charge et recommandations » : d'abord l'état en chiffres et les
// recommandations concrètes et actionnables, puis ce qui les justifie : le
// graphe d'équipe (vue d'ensemble) et la charge de chacun semaine par
// semaine (là où la surcharge se voit vraiment). Chaque recommandation vient d'une recherche gloutonne
// (shared/recommendations.js) qui simule réellement l'effet de chaque action
// candidate sur la charge, et elles sont classées du levier le moins
// intrusif (étaler une tâche) au plus lourd (ajouter de la capacité).
export function renderLoadChart(container, { domain, planning, load, people, users, ceiling, teamScoped, teamId, onApply }) {
  const { recommendations, overloadBefore, overloadAfter, stillOverloaded } = buildRecommendations(
    domain, planning, load, ceiling, { teamId },
  );
  container._recommendations = recommendations;

  const weeks = aggregate(load, people, ceiling);
  const overWeeks = weeks.filter((w) => w.over.length).length;
  const overPeople = people.filter((p) => (load.people[p.id] ?? []).some((r) => isOver(r, ceiling))).length;
  const calm = overloadBefore <= 0.01;
  const scope = teamScoped ? 'Team affichée' : 'Périmètre affiché';
  const range = weeks.length ? `${weekLabel(weeks[0].weekStart)} au ${weekLabel(weeks.at(-1).weekStart)}` : '';

  const status = calm
    ? '<p class="ch-note ok">Rien à signaler : personne ne dépasse le plafond de charge sur ce périmètre.</p>'
    : recommendations.length
      ? `<p class="ch-note">À appliquer dans l'ordre : chaque action est mesurée en tenant compte des précédentes.${stillOverloaded ? ` Il resterait ensuite ${Math.round(overloadAfter)} h qu'aucune action mesurée ne réduit plus (marges épuisées).` : ' Ensemble, elles suffisent à repasser sous le plafond partout.'}</p>`
      : `<p class="ch-note warn">${Math.round(overloadBefore)} h en surcharge, mais aucune marge disponible (échéances de projet ou dépendantes) pour la résorber sans capacité supplémentaire ni retard réel.</p>`;

  container.innerHTML = `
    <p class="ch-scope">${scope} · ${weeks.length} semaine${weeks.length > 1 ? 's' : ''}${range ? `, du ${range}` : ''} · plafond ${ceiling} %</p>
    <div class="ch-tiles">
      ${tile('Heures au-dessus du plafond', hoursText(overloadBefore), calm ? 'Aucune' : 'Cumul sur toutes les semaines', calm ? 'ok' : 'hot')}
      ${tile('Semaines touchées', `${overWeeks} / ${weeks.length}`, 'Au moins une personne au-dessus')}
      ${tile('Personnes au-dessus du plafond', `${overPeople} / ${people.length}`, 'Au moins une semaine')}
      ${tile('Après les recommandations', hoursText(calm ? 0 : overloadAfter), calm ? 'Rien à faire' : `${recommendations.length} action${recommendations.length > 1 ? 's' : ''} proposée${recommendations.length > 1 ? 's' : ''}`, !calm && !stillOverloaded ? 'ok' : '')}
    </div>
    <section class="ch-sec">
      <h3>Recommandations</h3>
      ${status}
      ${recommendations.length ? recoList(recommendations, overloadBefore) : ''}
    </section>
    <section class="ch-sec">
      <h3>Charge de l'équipe</h3>
      <div class="chartwrap" data-chartwrap><p class="hint">Pas assez de données pour tracer le graphe.</p></div>
    </section>
    <section class="ch-sec">
      <h3>Par personne</h3>
      ${people.length && weeks.length ? heatmap(load, people, users, ceiling) : '<p class="hint">Personne sur ce périmètre.</p>'}
    </section>`;

  // Le graphe est tracé à la largeur réelle de son cadre (textes à leur
  // vraie taille, sans agrandissement), et retracé si la fenêtre change.
  const wrap = container.querySelector('[data-chartwrap]');
  const drawChart = () => {
    const width = Math.max(300, Math.round(wrap.clientWidth || 760));
    const m = chartModel(load, people, ceiling, { width, height: 260, legend: false });
    if (!m) return;
    wrap.innerHTML = `<div class="ch-legend-html">
        <span><i class="ch-key ch-key-load"></i>Charge posée</span>
        <span><i class="ch-key ch-key-cap"></i>Disponibilité</span>
        <span><i class="ch-key ch-key-ceil"></i>Plafond (${ceiling} %)</span>
        ${m.weeks.some((w) => w.over.length) ? '<span><i class="ch-key ch-key-over"></i>Quelqu\'un au-dessus du plafond</span>' : ''}
        ${m.weeks.some((w) => w.hours > w.ceil + 0.01) ? '<span><i class="ch-key ch-key-dot"></i>Équipe au-dessus du plafond</span>' : ''}
      </div>${svgFromModel(m)}`;
    wireChartHover(wrap, m, ceiling);
  };
  drawChart();
  if (typeof ResizeObserver === 'function') {
    let lastWidth = wrap.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(wrap.clientWidth - lastWidth) < 8) return;
      lastWidth = wrap.clientWidth;
      drawChart();
    }).observe(wrap);
  }

  const scroll = container.querySelector('.hm-scroll');
  if (scroll) wireHeatHover(scroll, load, people, ceiling);

  container.querySelectorAll('[data-action="apply-reco"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reco = recommendations.find((r) => r.id === btn.dataset.reco);
      if (!reco) return;
      btn.disabled = true;
      btn.textContent = 'Envoyé';
      onApply(reco);
    });
  });
}
