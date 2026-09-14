import { barSegments, xOf, todayX, monthSpans, weekTicks } from './layout.js';
import { STATUS, esc, initials, shortDay, issueStatus } from './format.js';
import { addDays, isWorkingDay } from '../../shared/calendar.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NO_PROJECT_COLOR = '#6A6F76';
const CARET = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 6.8 5 3.5 8"/></svg>';

const px = (n) => `${n}px`;

export function createRowSink(leftRows, rightRows) {
  const sink = {
    top: 0,
    push(left, right, height) {
      leftRows.appendChild(left);
      rightRows.appendChild(right);
      sink.top += height;
    },
  };
  return sink;
}

export function rowPair(className, height) {
  const left = document.createElement('div');
  const right = document.createElement('div');
  left.className = className;
  right.className = className;
  if (height) {
    left.style.height = px(height);
    right.style.height = px(height);
  }
  return [left, right];
}

function positioned(className, left, width) {
  const el = document.createElement('div');
  if (className) el.className = className;
  el.style.left = px(left);
  if (width !== undefined) el.style.width = px(width);
  return el;
}

export function renderAxis(axisEl, axis, todayIso) {
  axisEl.innerHTML = '<div class="mo"></div><div class="wh"></div>';
  const [months, weeks] = axisEl.children;
  for (const m of monthSpans(axis)) {
    const el = positioned('', m.left, m.width);
    el.textContent = m.label;
    months.appendChild(el);
  }
  for (const w of weekTicks(axis)) {
    const el = positioned(w.monthStart ? 'm1' : '', w.left, w.width);
    el.textContent = w.label;
    weeks.appendChild(el);
  }
  const x = todayX(axis, todayIso);
  if (x !== null) {
    const tag = positioned('today-tag', x);
    tag.textContent = 'Aujourd\'hui';
    months.appendChild(tag);
  }
}

export function renderGrid(gridEl, axis, holidays, todayIso, height) {
  gridEl.innerHTML = '';
  gridEl.style.width = px(axis.width);
  gridEl.style.height = px(height);
  for (let i = 0; i < axis.days; i++) {
    const d = addDays(axis.from, i);
    if (!isWorkingDay(d, holidays)) {
      gridEl.appendChild(positioned(holidays.has(d) ? 'h' : 'o', i * axis.dayWidth, axis.dayWidth));
    }
    if (d.endsWith('-01')) gridEl.appendChild(positioned('m', i * axis.dayWidth));
  }
  const x = todayX(axis, todayIso);
  if (x !== null) gridEl.appendChild(positioned('td', x));
}

export function renderMilestones(sink, rightRows, projects, axis) {
  const [left, right] = rowPair('r jr');
  left.textContent = 'Jalons';
  for (const project of projects) {
    for (const milestone of project.milestones) {
      if (!milestone.date) continue;
      const x = todayX(axis, milestone.date);
      if (x === null) continue;
      const line = positioned('jl', x);
      line.style.color = project.color;
      rightRows.appendChild(line);
      const diamond = positioned('jd', x);
      diamond.style.color = project.color;
      const label = document.createElement('div');
      label.className = 'jt';
      label.style.color = project.color;
      label.textContent = `${milestone.name} · ${shortDay(milestone.date)}`;
      if (x < axis.width - 180) label.style.left = px(x + 10);
      else label.style.right = px(axis.width - x + 10);
      right.append(diamond, label);
    }
  }
  sink.push(left, right, 28);
}

export function renderGroups(sink, { view, axis, holidays, load, users, collapsed, selectedIssueId }) {
  const blocked = new Set(view.conflicts.map((c) => c.issueId));
  const rowY = {};
  const colorOf = {};

  for (const group of view.groups) {
    const [teamLeft, teamRight] = rowPair('r tb');
    teamLeft.innerHTML = `<a href="#/team/${encodeURIComponent(group.team.key)}">${esc(group.team.name)}</a>
      <span class="pm">${esc(group.team.key)}</span>`;
    sink.push(teamLeft, teamRight, 30);

    const blocks = group.projects.map((p) => ({
      key: `${group.team.id}:${p.project.id}`, project: p.project, issues: p.issues,
    }));
    if (group.noProject.length) {
      blocks.push({
        key: `${group.team.id}:none`,
        project: { id: null, name: 'Sans projet', color: NO_PROJECT_COLOR, startDate: null, targetDate: null },
        issues: group.noProject,
      });
    }

    for (const block of blocks) {
      const open = !collapsed.has(block.key);
      renderProjectRow(sink, block, open, axis);
      if (!open) continue;
      for (const issue of block.issues) {
        colorOf[issue.id] = block.project.color;
        renderIssueRow(sink, issue, {
          color: block.project.color,
          status: issueStatus(issue, blocked),
          axis, holidays, load, users,
          selected: issue.id === selectedIssueId,
        });
        rowY[issue.id] = sink.top - 12;
      }
    }
  }
  return { rowY, colorOf };
}

function renderProjectRow(sink, { key, project, issues }, open, axis) {
  const points = issues.reduce((s, i) => s + (i.estimate ?? 0), 0);
  const done = issues.filter((i) => i.status === 'done').reduce((s, i) => s + (i.estimate ?? 0), 0);
  const pct = points ? Math.round((done / points) * 100) : 0;
  const color = esc(project.color);
  const [left, right] = rowPair(`r p${open ? ' op' : ''}`);
  left.innerHTML = `<span class="tw" data-tog="${esc(key)}">${CARET}</span>
    <span class="sw" style="background:${color}"></span>
    <span class="pn" title="${esc(project.name)}">${esc(project.name)}</span>
    <span class="pbar" title="${pct} % des points terminés"><i style="width:${pct}%;background:${color}"></i></span>
    <span class="pm">${issues.length} tâches · ${points} pts · ${pct} %</span>`;
  if (project.startDate && project.targetDate) {
    const start = xOf(axis, project.startDate);
    const band = positioned('pband', start, Math.max(2, xOf(axis, project.targetDate) + axis.dayWidth - start));
    band.style.backgroundColor = project.color;
    right.appendChild(band);
  }
  sink.push(left, right, 28);
}

function teamSummary(issue, info, users) {
  const people = issue.contributorIds.map((id) => ({
    user: users.find((u) => u.id === id),
    rate: info?.perPerson[id]?.ratePct ?? null,
  }));
  if (!people.length) return '<span class="ov">personne</span>';
  if (people.length > 3) {
    const rates = people.map((p) => p.rate ?? 0);
    return `<i>${people.length} pers.</i> · ${Math.min(...rates)}–${Math.max(...rates)} %`;
  }
  return people
    .map((p) => `<i>${esc(initials(p.user))}</i> <span class="${(p.rate ?? 0) > 100 ? 'ov' : ''}">${p.rate ?? '—'}%</span>`)
    .join(' · ');
}

function renderIssueRow(sink, issue, { color, status, axis, holidays, load, users, selected }) {
  const [left, right] = rowPair(`r tk${issue.status === 'canceled' ? ' cx' : ''}${selected ? ' sel' : ''}`);
  left.dataset.t = issue.id;
  right.dataset.t = issue.id;
  const info = load.issues[issue.id];
  const warn = issue.unresolvedMentions.length > 0 || issue.contributorsSource === 'none';
  const noEstimate = issue.estimate === null;

  left.innerHTML = `<span class="pill" style="background:${STATUS[status].color}">${STATUS[status].label}</span>
    <span class="id">${esc(issue.identifier)}</span>
    <span class="nmw" title="${esc(issue.title)}">${esc(issue.title)}</span>
    <span class="flag" title="${warn ? 'Contributeurs à vérifier' : ''}">${warn ? '!' : ''}</span>
    <span class="tm" data-open="${esc(issue.id)}" title="Répartition">${teamSummary(issue, info, users)}</span>
    <span class="pts${noEstimate ? ' none' : ''}" title="${noEstimate ? 'Sans estimation' : 'Points'}">${noEstimate ? '—' : issue.estimate}</span>
    <span class="dt">${shortDay(issue.start)}</span><span class="dt">${shortDay(issue.end)}</span>`;

  const segments = barSegments(axis, issue.start, issue.end, holidays);
  segments.forEach((segment, k) => {
    const bar = positioned(`bar ${status === 'blocked' ? 'block' : issue.status}`, segment.left, segment.width);
    bar.style.backgroundColor = status === 'blocked' ? STATUS.blocked.color : color;
    bar.dataset.open = issue.id;
    right.appendChild(bar);
    const next = segments[k + 1];
    if (next) {
      const gapLeft = segment.left + segment.width;
      const gap = positioned('gp', gapLeft, next.left - gapLeft);
      gap.style.backgroundColor = color;
      right.appendChild(gap);
    }
  });

  const label = document.createElement('div');
  label.className = 'bl';
  const barEnd = xOf(axis, issue.end) + axis.dayWidth;
  if (barEnd > axis.width - 70) label.style.right = px(axis.width - xOf(axis, issue.start) + 5);
  else label.style.left = px(barEnd + 5);
  label.textContent = `${issue.status === 'done' ? '✓ ' : ''}${info?.days.length ?? 0} j · ${Math.round(info?.hours ?? 0)} h`;
  right.appendChild(label);

  sink.push(left, right, 24);
}

export function renderDependencies(svg, { rowY, colorOf, issues, conflicts, axis, height }) {
  svg.setAttribute('width', axis.width);
  svg.setAttribute('height', height);
  const conflicting = new Set(conflicts.map((c) => `${c.issueId}|${c.blockerId}`));
  const colors = [...new Set(Object.values(colorOf)), STATUS.blocked.color];
  svg.innerHTML = `<defs>${colors.map((c, i) => `<marker id="mk${i}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${esc(c)}"/></marker>`).join('')}</defs>`;

  const byId = new Map(issues.map((i) => [i.id, i]));
  for (const issue of issues) {
    for (const blockerId of issue.blockedBy) {
      if (rowY[issue.id] === undefined || rowY[blockerId] === undefined) continue;
      const blocker = byId.get(blockerId);
      const conflict = conflicting.has(`${issue.id}|${blockerId}`);
      const color = conflict ? STATUS.blocked.color : colorOf[issue.id];
      const x1 = xOf(axis, blocker.end) + axis.dayWidth;
      const y1 = rowY[blockerId];
      const x2 = xOf(axis, issue.start);
      const y2 = rowY[issue.id];
      const mid = (y1 + y2) / 2;
      const points = x2 >= x1 + 9
        ? `${x1},${y1} ${x1 + 5},${y1} ${x1 + 5},${y2} ${x2 - 4},${y2}`
        : `${x1},${y1} ${x1 + 5},${y1} ${x1 + 5},${mid} ${x2 - 10},${mid} ${x2 - 10},${y2} ${x2 - 4},${y2}`;
      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('points', points);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', conflict ? '1.4' : '1');
      line.setAttribute('opacity', conflict ? '.9' : '.66');
      if (conflict) line.setAttribute('stroke-dasharray', '3 2');
      line.setAttribute('marker-end', `url(#mk${colors.indexOf(color)})`);
      line.dataset.from = blockerId;
      line.dataset.to = issue.id;
      svg.appendChild(line);
    }
  }
}
