// src/ui/exportMarkdown.js
// Export Markdown de la vue affichée (une team ou toutes) : teams, projets,
// jalons, tâches (titre, description, statut, dates) et dépendances, dans un
// texte lisible tel quel ou à donner à un autre outil.
import { buildView } from './view.js';
import { blockedIssueIds } from '../shared/dependencies.js';
import { parseDescriptionText } from '../server/linear/parsing.js';
import { STATUS, ddmmyyyy, longDay, issueStatus } from './render/format.js';

const day = (iso) => (iso ? ddmmyyyy(iso) : '?');
const byStart = (a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999')
  || a.identifier.localeCompare(b.identifier, 'fr', { numeric: true });
// Un titre de tâche contient parfois des caractères qui casseraient la mise
// en forme d'une ligne (crochets, astérisques…) : on les échappe.
const inline = (s) => String(s ?? '').replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\s*\n\s*/g, ' ');
const quote = (text, indent = '') => text.split('\n').map((line) => `${indent}> ${line}`.trimEnd()).join('\n');

export function markdownFileName(domain, route, today) {
  const team = route.view === 'team' ? domain.teams.find((t) => t.key === route.teamKey) : null;
  const scope = team ? team.key : 'toutes-les-teams';
  return `planning-${scope.replace(/[^\w-]+/g, '-')}-${today}.md`;
}

export function buildMarkdown(domain, { route, showCanceled, today, fetchedAt }) {
  const view = buildView(domain, { route, showCanceled });
  const teams = view.groups.map((g) => g.team);
  const teamIds = new Set(teams.map((t) => t.id));
  const visible = (i) => showCanceled || i.status !== 'canceled';
  const scoped = domain.issues.filter((i) => teamIds.has(i.teamId) && visible(i));
  const byId = new Map(domain.issues.map((i) => [i.id, i]));
  const userName = (id) => domain.users.find((u) => u.id === id)?.name ?? '?';
  const stateName = (id) => domain.workflowStates.find((s) => s.id === id)?.name;
  const teamKey = (id) => domain.teams.find((t) => t.id === id)?.key ?? '?';
  const blockedIds = blockedIssueIds(domain.issues);
  const conflictPairs = new Set(view.conflicts.map((c) => `${c.blockerId}>${c.issueId}`));
  const blocks = new Map();
  for (const issue of domain.issues) {
    for (const blockerId of issue.blockedBy) {
      if (!blocks.has(blockerId)) blocks.set(blockerId, []);
      blocks.get(blockerId).push(issue.id);
    }
  }
  const ref = (id) => {
    const i = byId.get(id);
    return i ? `${i.identifier} (${inline(i.title)})` : id;
  };

  const status = (issue) => {
    const label = STATUS[issueStatus(issue, blockedIds)].label;
    const linear = stateName(issue.stateId);
    return linear ? `${label} (Linear : ${linear})` : label;
  };
  const dates = (issue) => {
    if (issue.start) return `du ${day(issue.start)} au ${day(issue.end)}`;
    const known = [
      issue.startDate && `début ${day(issue.startDate)}`,
      issue.dueDate && `échéance ${day(issue.dueDate)}`,
    ].filter(Boolean);
    return `non planifiée (${issue.unplannedReason ?? 'dates manquantes'})${known.length ? `, ${known.join(', ')}` : ''}`;
  };
  const contributors = (issue) => {
    if (issue.contributorIds.length) return issue.contributorIds.map(userName).join(', ');
    return issue.contributorsSource === 'nobody' ? 'personne (indiqué explicitement)' : 'aucun';
  };

  const taskBlock = (issue) => {
    const lines = [`#### ${issue.identifier} · ${inline(issue.title)}`, ''];
    lines.push(`- Statut : ${status(issue)}`);
    lines.push(`- Dates : ${dates(issue)}`);
    const points = issue.estimate ?? 'non estimée';
    lines.push(`- Points : ${points}${issue.realPoints != null ? ` (réels : ${issue.realPoints})` : ''}`);
    lines.push(`- Contributeurs : ${contributors(issue)}`);
    if (issue.parentId) lines.push(`- Tâche parente : ${ref(issue.parentId)}`);
    const blockers = issue.blockedBy.filter((id) => byId.has(id));
    if (blockers.length) {
      lines.push(`- Bloquée par : ${blockers.map((id) => `${ref(id)}${conflictPairs.has(`${id}>${issue.id}`) ? ' **conflit : commence avant sa fin**' : ''}`).join(' ; ')}`);
    }
    const dependents = blocks.get(issue.id) ?? [];
    if (dependents.length) lines.push(`- Bloque : ${dependents.map(ref).join(' ; ')}`);
    const text = parseDescriptionText(issue.rawDescription);
    lines.push('', text ? quote(text) : '_Pas de description._', '');
    return lines.join('\n');
  };

  const tasksSection = (issues) => (issues.length
    ? [...issues].sort(byStart).map(taskBlock).join('\n')
    : '_Aucune tâche._\n');

  const out = [];
  const title = route.view === 'team' ? (teams[0]?.name ?? route.teamKey) : 'toutes les teams';
  out.push(`# 1PACTE Planning · ${inline(title)}`, '');
  out.push(`Export du ${longDay(today)} · données Linear du ${new Date(fetchedAt).toLocaleString('fr-FR')}.`);
  out.push(`Tâches annulées ${showCanceled ? 'incluses' : 'masquées'}. Dates au format jj/mm/aaaa.`, '');
  if (view.notFound) {
    out.push(`Team « ${inline(route.teamKey)} » introuvable dans le workspace.`, '');
    return out.join('\n');
  }

  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  for (const issue of scoped) counts[issueStatus(issue, blockedIds)] += 1;
  const projectCount = new Set(domain.projects.filter((p) => p.teamIds.some((id) => teamIds.has(id))).map((p) => p.id)).size;
  out.push('## Résumé', '');
  out.push(`- Teams : ${teams.map((t) => `${inline(t.name)} (${t.key})`).join(', ') || 'aucune'}`);
  out.push(`- Projets : ${projectCount}`);
  out.push(`- Tâches : ${scoped.length} (${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS[k].label.toLowerCase()}`).join(', ') || 'aucune'})`);
  out.push(`- Non planifiées : ${scoped.filter((i) => !i.start).length}`);
  out.push(`- Conflits de dépendances : ${view.conflicts.filter((c) => teamIds.has(byId.get(c.issueId)?.teamId)).length}`, '');

  for (const team of teams) {
    const issues = scoped.filter((i) => i.teamId === team.id);
    out.push(`## Team ${inline(team.name)} (${team.key})`, '');
    out.push(`Membres : ${team.memberIds.map(userName).sort((a, b) => a.localeCompare(b, 'fr')).join(', ') || 'aucun'}.`, '');
    const projects = domain.projects
      .filter((p) => p.teamIds.includes(team.id))
      .sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || a.name.localeCompare(b.name, 'fr'));
    for (const project of projects) {
      const own = issues.filter((i) => i.projectId === project.id);
      const points = own.reduce((s, i) => s + (i.estimate ?? 0), 0);
      const donePoints = own.filter((i) => i.status === 'done').reduce((s, i) => s + (i.estimate ?? 0), 0);
      out.push(`### Projet : ${inline(project.name)}`, '');
      out.push(`- Période : ${project.startDate || project.targetDate ? `du ${day(project.startDate)} au ${day(project.targetDate)}` : 'non datée'}`);
      if (project.teamIds.length > 1) out.push(`- Teams : ${project.teamIds.map(teamKey).join(', ')}`);
      out.push(`- Avancement : ${own.filter((i) => i.status === 'done').length} / ${own.length} tâches terminées, ${donePoints} / ${points} points`);
      const milestones = [...project.milestones].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
      out.push(`- Jalons :${milestones.length ? '' : ' aucun'}`);
      for (const m of milestones) {
        const passed = m.date && m.date < today ? ' (passé)' : '';
        out.push(`  - ${m.date ? day(m.date) : 'sans date'} · ${inline(m.name)}${passed}`);
      }
      out.push('', tasksSection(own));
    }
    const known = new Set(projects.map((p) => p.id));
    const loose = issues.filter((i) => !known.has(i.projectId));
    if (loose.length) out.push('### Hors projet', '', tasksSection(loose));
  }

  // Toutes les dépendances qui touchent la vue, y compris vers une tâche
  // d'une autre team : chacune sur une ligne, bloqueuse puis dépendante.
  const edges = domain.issues
    .flatMap((issue) => issue.blockedBy.map((blockerId) => ({ issue, blocker: byId.get(blockerId) })))
    .filter(({ issue, blocker }) => blocker && (scoped.includes(issue) || scoped.includes(blocker)))
    .sort((a, b) => byStart(a.blocker, b.blocker) || byStart(a.issue, b.issue));
  out.push('## Dépendances', '');
  out.push('Chaque ligne se lit « A bloque B » : B ne devrait pas commencer avant la fin de A.', '');
  if (!edges.length) out.push('_Aucune dépendance._');
  for (const { issue, blocker } of edges) {
    const conflict = conflictPairs.has(`${blocker.id}>${issue.id}`);
    const end = blocker.end ? `fin ${day(blocker.end)}` : 'non planifiée';
    const start = issue.start ? `début ${day(issue.start)}` : 'non planifiée';
    out.push(`- ${ref(blocker.id)} [${STATUS[blocker.status].label}, ${end}] bloque ${ref(issue.id)} [${STATUS[issue.status].label}, ${start}]${conflict ? ' · **conflit**' : ''}`);
  }
  if (view.cycles.length) {
    out.push('', '**Dépendances circulaires :**', '');
    for (const cycle of view.cycles) out.push(`- ${[...cycle, cycle[0]].map((id) => byId.get(id)?.identifier ?? id).join(' → ')}`);
  }
  out.push('');
  return out.join('\n');
}
