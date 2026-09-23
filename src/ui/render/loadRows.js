import { rowPair } from './board.js';
import { dayIndex } from './layout.js';
import { esc, initials, personColor, fr1 } from './format.js';
import { personStats } from '../../shared/load.js';

export function tint(pct, ceiling) {
  if (pct > 100) return { background: '#B23A3A', color: '#fff' };
  if (pct > ceiling) return { background: '#E5B274', color: '#3A2405' };
  if (pct >= ceiling * 0.62) return { background: '#9CC9B2', color: '#12301F' };
  return { background: '#DEECE4', color: '#1D3B2C' };
}

const pctText = (pct) => (Number.isFinite(pct) ? `${Math.round(pct)} %` : '∞');

const MODES = [['planned', 'Prévue'], ['real', 'Réelle'], ['both', 'Comparer']];

// mode : 'planned' (défaut), 'real' (heures réelles dérivées des points réels
// des tâches) ou 'both' (prévu et réel côte à côte dans chaque cellule).
export function renderLoadRows(sink, { people, load, planning, axis, users, teamScoped, mode = 'planned' }) {
  const [bandLeft, bandRight] = rowPair('r band');
  const label = { planned: 'prévisionnelle', real: 'réelle', both: 'prévue vs réelle' }[mode] ?? 'prévisionnelle';
  bandLeft.innerHTML = `<span>Charge ${label} ${teamScoped ? 'de la team' : 'par personne'}</span>
    <span class="lmode" role="group" aria-label="Type de charge">${MODES.map(([m, text]) => `<button type="button" data-load-mode="${m}" class="${m === mode ? 'on' : ''}">${text}</button>`).join('')}</span>`;
  sink.push(bandLeft, bandRight, 30);

  const ceiling = planning.settings.loadCeilingPct;

  for (const user of people) {
    const weeks = load.people[user.id];
    const stats = personStats(weeks);
    const role = planning.people.find((p) => p.linearUserId === user.id)?.role;
    const [left, right] = rowPair('r ld');
    left.innerHTML = `<span class="ini" style="background-color:${personColor(user.id, users)}">${esc(initials(user))}</span>
      <span class="who" data-person="${esc(user.id)}"><b>${esc(user.name)}</b><span>${esc(role || 'rôle à préciser')}</span></span>
      <span class="sm">${Math.round(stats.total)} h sur ${stats.activeWeeks} sem.<br>
        <span style="color:${stats.peakPct > ceiling ? '#B9700A' : 'var(--ink3)'}">pic ${pctText(stats.peakPct)} · moy. ${Math.round(stats.avgPct)} %</span></span>`;

    for (const week of weeks) {
      const hasReal = week.realHours > 0.01;
      // Vue réelle : pas de cellule sans charge réelle (elle compte pour 0).
      if (mode === 'real' ? !hasReal : (week.hours <= 0.01 && !(mode === 'both' && hasReal))) continue;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.pw = `${user.id}|${week.weekStart}`;
      cell.style.left = `${dayIndex(axis, week.weekStart) * axis.dayWidth}px`;
      cell.style.width = `${7 * axis.dayWidth - 1.5}px`;
      cell.title = `Prévu ${fr1(week.hours)} h · réel ${fr1(week.realHours ?? 0)} h`;
      const wide = 7 * axis.dayWidth > 34;
      if (mode === 'real') {
        const pct = week.realPct ?? 0;
        const t = tint(pct, ceiling);
        cell.style.backgroundColor = t.background;
        cell.style.color = t.color;
        cell.innerHTML = wide ? `<b>${fr1(week.realHours)} h</b><u>${Math.round(pct)} %</u>` : `<b>${Math.round(pct)}%</b>`;
      } else if (week.unavailable) {
        cell.style.backgroundColor = '#B23A3A';
        cell.style.color = '#fff';
        cell.innerHTML = '<b>indispo.</b>';
      } else {
        const t = tint(week.pct, ceiling);
        cell.style.backgroundColor = t.background;
        cell.style.color = t.color;
        if (mode === 'both') {
          cell.innerHTML = wide
            ? `<b>${fr1(week.hours)} h</b><u>réel ${fr1(week.realHours ?? 0)} h</u>`
            : `<b>${Math.round(week.pct)}%</b>`;
        } else {
          cell.innerHTML = wide ? `<b>${fr1(week.hours)} h</b><u>${Math.round(week.pct)} %</u>` : `<b>${Math.round(week.pct)}%</b>`;
        }
      }
      // Mode prévu : la charge réelle reste visible en filet sombre en bas de la
      // cellule, proportionnel à la capacité.
      if (mode === 'planned' && hasReal) {
        const real = document.createElement('i');
        real.className = 'rl';
        real.style.width = `${Math.min(100, Number.isFinite(week.realPct) ? week.realPct : 100)}%`;
        cell.appendChild(real);
      }
      right.appendChild(cell);
    }
    sink.push(left, right, 34);
  }
}
