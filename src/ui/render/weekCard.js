// src/ui/render/weekCard.js
// Carte « reçu de la semaine », ouverte d'un clic sur une cellule de la bande
// de charge : de quoi est faite la charge d'une personne une semaine donnée.
// En tête, la jauge charge / capacité ; dessous, une barre composée d'un
// segment par tâche (couleur du projet, longueur en heures) avec le plafond et
// le dépassement ; puis la liste des tâches, chacune avec sa frise lun. → dim.
import { addDays, isWorkingDay } from '../../shared/calendar.js';
import { esc, initials, personColor, fr1 } from './format.js';
import { tint } from './loadRows.js';

const NO_PROJECT_COLOR = '#6A6F76';
const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const dayNum = (iso) => Number(iso.slice(8, 10));
const monthOf = (iso) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];

// « Semaine du 14 au 20 sept. », ou « du 28 sept. au 4 oct. » à cheval sur
// deux mois.
export function weekLabel(weekStart) {
  const end = addDays(weekStart, 6);
  return monthOf(weekStart) === monthOf(end)
    ? `Semaine du ${dayNum(weekStart)} au ${dayNum(end)} ${monthOf(end)}`
    : `Semaine du ${dayNum(weekStart)} ${monthOf(weekStart)} au ${dayNum(end)} ${monthOf(end)}`;
}

function gauge(pct, ceiling) {
  const r = 21;
  const c = 2 * Math.PI * r;
  const shown = Math.min(100, Number.isFinite(pct) ? pct : 100);
  const { background } = tint(pct, ceiling);
  return `<svg class="wc-gauge" viewBox="0 0 54 54" aria-hidden="true">
    <circle cx="27" cy="27" r="${r}" class="wc-gauge-track"/>
    <circle cx="27" cy="27" r="${r}" class="wc-gauge-fill" stroke="${background}"
      stroke-dasharray="${(c * shown) / 100} ${c}" transform="rotate(-90 27 27)"/>
    <text x="27" y="31" text-anchor="middle">${Number.isFinite(pct) ? `${Math.round(pct)}%` : '∞'}</text>
  </svg>`;
}

export function weekCardHtml({ user, users, weekStart, rows, capacity, ceiling, projects, holidays }) {
  const total = rows.reduce((s, r) => s + r.hours, 0);
  const realTotal = rows.reduce((s, r) => s + r.realHours, 0);
  const pct = capacity > 0 ? (total / capacity) * 100 : (total > 0 ? Infinity : 0);
  const colorOf = (issue) => projects.find((p) => p.id === issue.projectId)?.color ?? NO_PROJECT_COLOR;
  // Échelle de la barre : la capacité, ou la charge si elle la dépasse.
  const scale = Math.max(capacity, total) || 1;
  const pctOf = (h) => (h / scale) * 100;
  const days = Array.from({ length: 7 }, (_, k) => addDays(weekStart, k));

  const segments = rows.filter((r) => r.hours > 0.01).map((r) => `<i class="${r.unassigned ? 'ua' : ''}"
    style="width:${pctOf(r.hours)}%;background-color:${esc(colorOf(r.issue))}" title="${esc(r.issue.identifier)} · ${fr1(r.hours)} h"></i>`).join('');
  const over = total > capacity && capacity > 0
    ? `<b class="wc-over" style="left:${pctOf(capacity)}%;width:${100 - pctOf(capacity)}%"></b>` : '';
  const ceilingMark = capacity > 0
    ? `<b class="wc-ceil" style="left:${pctOf((capacity * ceiling) / 100)}%" title="Plafond ${ceiling} %"></b>` : '';

  const list = rows.map((r) => `<button type="button" class="wc-row" data-open="${esc(r.issue.id)}">
      <span class="wc-sw" style="background-color:${esc(colorOf(r.issue))}"></span>
      <span class="wc-name"><b>${esc(r.issue.identifier)}</b> ${esc(r.issue.title)}
        ${r.unassigned ? '<em>sans personne, réparti dans la team</em>' : ''}</span>
      <span class="wc-days" style="--c:${esc(colorOf(r.issue))}" aria-label="${r.days.length} jour${r.days.length > 1 ? 's' : ''} cette semaine">${days.map((d, k) => `<i class="${r.days.includes(d) ? 'on' : ''}${isWorkingDay(d, holidays) ? '' : ' off'}" title="${DAY_LETTERS[k]}"></i>`).join('')}</span>
      <span class="wc-h">${fr1(r.hours)} h<small>${total > 0 ? Math.round((r.hours / total) * 100) : 0} %</small></span>
    </button>`).join('');

  return `<header class="wc-head">
      <span class="ini" style="background-color:${personColor(user.id, users)}">${esc(initials(user))}</span>
      <div class="wc-who"><b>${esc(user.name)}</b><span>${weekLabel(weekStart)}</span></div>
      ${gauge(pct, ceiling)}
    </header>
    <p class="wc-sum"><b>${fr1(total)} h</b> prévues sur ${fr1(capacity)} h de capacité${realTotal > 0.01 ? ` · ${fr1(realTotal)} h réelles` : ''}</p>
    <div class="wc-bar" role="img" aria-label="Répartition de la charge entre ${rows.length} tâche${rows.length > 1 ? 's' : ''}">${segments}${over}${ceilingMark}</div>
    ${rows.length ? `<div class="wc-legend" aria-hidden="true"><span>${rows.length} tâche${rows.length > 1 ? 's' : ''}</span>
      <span class="wc-days">${DAY_LETTERS.map((l) => `<i>${l}</i>`).join('')}</span><span></span></div>` : ''}
    <div class="wc-list">${list || '<p class="wc-empty">Aucune tâche cette semaine.</p>'}</div>
    ${rows.length ? '<p class="wc-foot">Cliquez une tâche pour l\'ouvrir.</p>' : ''}`;
}
