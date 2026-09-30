// src/ui/print.js
// Impression du planning en pages A4 paysage lisibles, plutôt qu'une seule
// feuille réduite jusqu'à l'illisible : la frise est rendue à une largeur de
// jour choisie pour le papier, puis découpée en colonnes de période (calées
// sur les mois) et en tranches de lignes, chaque page reprenant la colonne
// de gauche (tâches), l'axe des dates et la légende.
import { addDays, daysBetween } from '../shared/calendar.js';
import { MAX_DAY_WIDTH } from './render/layout.js';
import { longDay } from './render/format.js';

// A4 paysage, marges de 10 mm (cf. @page dans styles.css), à 96 px/pouce,
// arrondi vers le bas pour absorber les écarts d'arrondi du moteur
// d'impression.
const PAGE_PX = { width: 1040, height: 705 };
// Échelle d'impression unique : le texte à 12 px (cf. @media print) sort
// autour de 7 pt, la taille courante d'un Gantt papier.
export const PRINT_SCALE = 0.8;
// En dessous, les barres courtes et les semaines deviennent illisibles :
// on passe alors à plusieurs pages en largeur.
const MIN_DAY_WIDTH = 5;

const nextMonth = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

// Mois (bornés à la plage) regroupés en colonnes consécutives d'au plus
// `capacity` jours.
function packMonths(months, capacity) {
  const columns = [];
  let current = null;
  for (const month of months) {
    if (current && current.days + month.days <= capacity) {
      current.to = month.to;
      current.days += month.days;
    } else {
      current = { ...month };
      columns.push(current);
    }
  }
  return columns;
}

// Choisit la largeur d'un jour et découpe la plage en colonnes de période
// pour une frise de `timelineWidth` px par page : le moins de colonnes
// possible sans descendre sous MIN_DAY_WIDTH, coupées en début de mois,
// puis réparties au plus égal pour que la plus large (qui fixe l'échelle,
// commune à toutes les pages) soit la plus étroite possible — neuf mois
// donnent trois pages de trois mois, pas deux pleines et une presque vide.
export function planPrintColumns(range, timelineWidth) {
  const days = daysBetween(range.from, range.to) + 1;
  const capacity = Math.floor(timelineWidth / MIN_DAY_WIDTH);
  let columns = [{ from: range.from, to: range.to, days }];
  if (days > capacity) {
    const months = [];
    for (let first = range.from; first <= range.to; first = nextMonth(first)) {
      const last = addDays(nextMonth(first), -1) < range.to ? addDays(nextMonth(first), -1) : range.to;
      months.push({ from: first, to: last, days: daysBetween(first, last) + 1 });
    }
    const count = packMonths(months, capacity).length;
    let balanced = Math.max(...months.map((m) => m.days));
    while (packMonths(months, balanced).length > count) balanced += 1;
    columns = packMonths(months, balanced);
  }
  const widest = Math.max(...columns.map((c) => c.days));
  return {
    dayWidth: Math.min(MAX_DAY_WIDTH, timelineWidth / widest),
    columns: columns.map(({ from, to }) => ({ from, to })),
  };
}

// Regroupe des lignes consécutives (hauteurs en px) en tranches d'au plus
// `budget` px (`firstBudget` pour la première), sans jamais couper une
// ligne. Renvoie [{ top, height }].
export function sliceRows(heights, budget, firstBudget = budget) {
  const slices = [];
  let top = 0;
  let current = null;
  for (const h of heights) {
    const limit = slices.length === 1 ? firstBudget : budget;
    if (!current || (current.height + h > limit && current.height > 0)) {
      current = { top, height: 0 };
      slices.push(current);
    }
    current.height += h;
    top += h;
  }
  return slices;
}

// Largeur de frise disponible par page, une fois la colonne de gauche posée.
export function printTimelineWidth(leftWidth) {
  return Math.floor(PAGE_PX.width / PRINT_SCALE - leftWidth - 4);
}

const clip = (child, { width, height, x = 0, y = 0 }) => {
  const box = document.createElement('div');
  box.className = 'pp-clip';
  if (width !== undefined) box.style.width = `${width}px`;
  if (height !== undefined) box.style.height = `${height}px`;
  child.style.marginLeft = `${-x}px`;
  child.style.marginTop = `${-y}px`;
  box.appendChild(child);
  return box;
};

// Les flèches de dépendances pointent vers leurs marqueurs par id : chaque
// copie reçoit les siens, sinon toutes renverraient à ceux du plateau
// d'écran, masqué à l'impression.
function renameMarkers(svg, suffix) {
  for (const marker of svg.querySelectorAll('marker[id]')) marker.id = `${marker.id}-${suffix}`;
  for (const el of svg.querySelectorAll('[marker-end]')) {
    el.setAttribute('marker-end', el.getAttribute('marker-end').replace(/#([^)]+)\)/, `#$1-${suffix})`));
  }
}

// Hauteur d'un bloc (en-tête, légende) une fois posé à la largeur d'une page
// imprimée, où il passe souvent sur plus de lignes qu'à l'écran.
function measureAtPageWidth(sheet, el) {
  if (!el) return 0;
  const probe = document.createElement('div');
  probe.className = 'print-probe';
  probe.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;width:${PAGE_PX.width / PRINT_SCALE}px`;
  probe.appendChild(el.cloneNode(true));
  sheet.appendChild(probe);
  const { height } = probe.getBoundingClientRect();
  probe.remove();
  return height + 10;
}

// Construit les pages imprimables à partir du plateau déjà rendu (à la
// largeur de jour de planPrintColumns) dans la feuille. Les mesures se font
// sur le plateau d'écran, encore visible à ce moment-là.
export function buildPrintPages(sheet, { axis, columns, title }) {
  const board = sheet.querySelector('.board');
  if (!board || board.hidden) return;
  const leftPane = board.querySelector('.pl');
  const leftAxis = leftPane.querySelector('.ax');
  const leftRows = leftPane.querySelector('[data-left]');
  const axisEl = board.querySelector('[data-axis]');
  const rowsEl = board.querySelector('[data-right]');
  const header = sheet.querySelector('.hd');
  const legend = sheet.querySelector('.lg');

  const axisHeight = axisEl.getBoundingClientRect().height;
  const heights = [...leftRows.children].map((r) => r.getBoundingClientRect().height);
  // Réservé sur chaque page : légende de page, axe et légende des couleurs ;
  // en plus, sur la première page de chaque période, l'en-tête (titre et
  // chiffres clés) que seule la toute première porte — les tranches de
  // lignes restent ainsi identiques d'une période à l'autre.
  const reserved = 26 + axisHeight + measureAtPageWidth(sheet, legend) + 12;
  const budget = PAGE_PX.height / PRINT_SCALE - reserved;
  const slices = sliceRows(heights, budget, budget - measureAtPageWidth(sheet, header));

  const pages = document.createElement('div');
  pages.className = 'print-pages';
  pages.style.zoom = String(PRINT_SCALE);
  const total = columns.length * slices.length;
  let n = 0;
  for (const column of columns) {
    const x = Math.round(daysBetween(axis.from, column.from) * axis.dayWidth);
    const width = Math.round((daysBetween(column.from, column.to) + 1) * axis.dayWidth);
    for (const slice of slices) {
      n += 1;
      const page = document.createElement('section');
      page.className = 'pp';
      if (n === 1 && header) page.appendChild(header.cloneNode(true));
      const caption = document.createElement('div');
      caption.className = 'pp-cap';
      caption.innerHTML = '<b></b><span></span><span></span>';
      caption.children[0].textContent = title;
      caption.children[1].textContent = `${longDay(column.from)} → ${longDay(column.to)}`;
      caption.children[2].textContent = `Page ${n} / ${total}`;
      page.appendChild(caption);

      const pageBoard = document.createElement('div');
      pageBoard.className = 'board pp-board';
      const left = document.createElement('div');
      left.className = 'pl';
      left.append(leftAxis.cloneNode(true), clip(leftRows.cloneNode(true), { height: slice.height, y: slice.top }));
      const right = document.createElement('div');
      right.className = 'pr';
      const axisCopy = axisEl.cloneNode(true);
      axisCopy.style.width = `${axis.width}px`;
      const rowsCopy = rowsEl.cloneNode(true);
      rowsCopy.style.width = `${axis.width}px`;
      renameMarkers(rowsCopy.querySelector('svg.dep'), `p${n}`);
      right.append(
        clip(axisCopy, { width, height: axisHeight, x }),
        clip(rowsCopy, { width, height: slice.height, x, y: slice.top }),
      );
      pageBoard.append(left, right);
      page.appendChild(pageBoard);
      if (legend) page.appendChild(legend.cloneNode(true));
      pages.appendChild(page);
    }
  }
  board.after(pages);
  sheet.classList.add('printing');
}

export function clearPrintPages(sheet) {
  sheet?.querySelector('.print-pages')?.remove();
  sheet?.classList.remove('printing');
}
