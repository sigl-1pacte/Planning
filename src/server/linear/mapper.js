import { parseStartingDate, parseContributors } from './parsing.js';

const STATUS = {
  triage: 'todo', backlog: 'todo', unstarted: 'todo',
  started: 'doing', completed: 'done', canceled: 'canceled',
};

const isoDay = (v) => (v ? String(v).slice(0, 10) : null);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function mapWorkspace(raw) {
  const users = raw.users
    .map((u) => ({ id: u.id, name: u.name, displayName: u.displayName ?? null, email: u.email, active: u.active }))
    .sort(byId);
  const teams = raw.teams.map((t) => ({ id: t.id, key: t.key, name: t.name })).sort(byId);
  const projects = raw.projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color ?? '#6A6F76',
    startDate: isoDay(p.startDate),
    targetDate: isoDay(p.targetDate),
    teamIds: p.teams.nodes.map((t) => t.id).sort(),
    milestones: p.projectMilestones.nodes
      .map((m) => ({ id: m.id, name: m.name, date: isoDay(m.targetDate) }))
      .sort(byId),
  })).sort(byId);

  const known = new Set(raw.issues.map((i) => i.id));
  const blockers = new Map();
  const addBlock = (blocked, blocker) => {
    if (!known.has(blocked) || !known.has(blocker)) return;
    if (!blockers.has(blocked)) blockers.set(blocked, new Set());
    blockers.get(blocked).add(blocker);
  };
  for (const i of raw.issues) {
    for (const r of i.relations.nodes) if (r.type === 'blocks') addBlock(r.relatedIssue.id, i.id);
    for (const r of i.inverseRelations.nodes) if (r.type === 'blocks') addBlock(i.id, r.issue.id);
  }

  const issues = raw.issues
    .map((i) => mapIssue(i, users, [...(blockers.get(i.id) ?? [])].sort()))
    .sort(byId);

  return { teams, users, projects, issues };
}

function mapIssue(i, users, blockedBy) {
  const start = parseStartingDate(i.description);
  const end = isoDay(i.dueDate);
  let unplannedReason = null;
  if (!start.ok) unplannedReason = start.reason;
  else if (!end) unplannedReason = 'Aucune date d\'échéance (Due date)';
  else if (end < start.date) unplannedReason = `Échéance ${end} antérieure au début ${start.date}`;
  const planned = unplannedReason === null;

  const contrib = parseContributors(i.description, users);
  let contributorIds = [];
  let contributorsSource = 'none';
  if (contrib.userIds.length) {
    contributorIds = contrib.userIds;
    contributorsSource = 'description';
  } else if (i.assignee) {
    contributorIds = [i.assignee.id];
    contributorsSource = 'assignee';
  }

  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    teamId: i.team.id,
    projectId: i.project?.id ?? null,
    parentId: i.parent?.id ?? null,
    estimate: i.estimate ?? null,
    status: STATUS[i.state.type] ?? 'todo',
    assigneeId: i.assignee?.id ?? null,
    start: planned ? start.date : null,
    end: planned ? end : null,
    unplannedReason,
    contributorIds,
    contributorsSource,
    unresolvedMentions: contrib.unresolved,
    blockedBy,
    updatedAt: i.updatedAt,
    // Conservée pour les écritures qui réécrivent la description (cascade de
    // replanification) : sans elle, remplacer la ligne « Starting date »
    // effacerait le reste de la description, Contributors compris.
    rawDescription: i.description ?? null,
  };
}
