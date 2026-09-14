import { isValidDate } from '../../shared/calendar.js';

const START_RE = /^\s*Starting date\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/im;
const START_LABEL_RE = /^\s*Starting date\s*:(.*)$/im;
const CONTRIB_RE = /^\s*Contributors\s*:\s*(.+)$/im;
const MENTION_RE = /@([\p{L}\p{N}._-]+)/gu;
const NO_LINE = 'Aucune ligne « Starting date » dans la description';

export function parseStartingDate(description) {
  if (!description) return { ok: false, reason: NO_LINE };
  const m = description.match(START_RE);
  if (!m) {
    const label = description.match(START_LABEL_RE);
    return label
      ? { ok: false, reason: `Ligne « Starting date » illisible : « ${label[1].trim()} »` }
      : { ok: false, reason: NO_LINE };
  }
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidDate(y, mo, d)) {
    return { ok: false, reason: `Date de début impossible : ${m[1]}/${m[2]}/${m[3]}` };
  }
  const p = (n) => String(n).padStart(2, '0');
  return { ok: true, date: `${y}-${p(mo)}-${p(d)}` };
}

export function resolveMention(token, users) {
  const t = token.toLowerCase();
  return users.find((u) => u.displayName?.toLowerCase() === t)
    ?? users.find((u) => u.name.toLowerCase() === t)
    ?? users.find((u) => u.email.split('@')[0].toLowerCase() === t)
    ?? null;
}

export function parseContributors(comments, users) {
  const newestFirst = [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const c of newestFirst) {
    const line = c.body.match(CONTRIB_RE);
    if (!line) continue;
    const userIds = [];
    const unresolved = [];
    for (const [, token] of line[1].matchAll(MENTION_RE)) {
      const user = resolveMention(token, users);
      if (!user) unresolved.push(token);
      else if (!userIds.includes(user.id)) userIds.push(user.id);
    }
    return { found: true, commentId: c.id, userIds, unresolved };
  }
  return { found: false, commentId: null, userIds: [], unresolved: [] };
}
