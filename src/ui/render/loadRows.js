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

export function renderLoadRows(sink, { people, load, planning, axis, users, teamScoped }) {
  const [bandLeft, bandRight] = rowPair('r band');
  bandLeft.innerHTML = `<span>Charge prévisionnelle ${teamScoped ? 'de la team' : 'par personne'}</span>
    <span class="n">heures de la semaine · taux d'occupation</span>`;
  bandRight.innerHTML = '<button class="lcbtn" type="button" data-action="load-chart" title="Recommandations de charge et disponibilité">Reco</button>';
  sink.push(bandLeft, bandRight, 30);

  const ceiling = planning.settings.loadCeilingPct;

  for (const user of people) {
    const weeks = load.people[user.id];
    const stats = personStats(weeks);
    const role = planning.people.find((p) => p.linearUserId === user.id)?.role;
    const [left, right] = rowPair('r ld');
    left.innerHTML = `<span class="ini" style="background:${personColor(user.id, users)}">${esc(initials(user))}</span>
      <span class="who" data-person="${esc(user.id)}"><b>${esc(user.name)}</b><span>${esc(role || 'rôle à préciser')}</span></span>
      <span class="sm">${Math.round(stats.total)} h sur ${stats.activeWeeks} sem.<br>
        <span style="color:${stats.peakPct > ceiling ? '#B9700A' : 'var(--ink3)'}">pic ${pctText(stats.peakPct)} · moy. ${Math.round(stats.avgPct)} %</span></span>`;

    for (const week of weeks) {
      if (week.hours <= 0.01) continue;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.pw = `${user.id}|${week.weekStart}`;
      cell.style.left = `${dayIndex(axis, week.weekStart) * axis.dayWidth}px`;
      cell.style.width = `${7 * axis.dayWidth - 1.5}px`;
      if (week.unavailable) {
        cell.style.backgroundColor = '#B23A3A';
        cell.style.color = '#fff';
        cell.innerHTML = '<b>indispo.</b>';
      } else {
        const t = tint(week.pct, ceiling);
        cell.style.backgroundColor = t.background;
        cell.style.color = t.color;
        cell.innerHTML = 7 * axis.dayWidth > 34
          ? `<b>${fr1(week.hours)} h</b><u>${Math.round(week.pct)} %</u>`
          : `<b>${Math.round(week.pct)}%</b>`;
      }
      right.appendChild(cell);
    }
    sink.push(left, right, 34);
  }
}
