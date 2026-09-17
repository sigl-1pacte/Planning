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

// La ligne « Contributors » vit dans la description (comme « Starting
// date »), pas dans un commentaire : ça reste au même endroit que le reste
// de la planification, et un commentaire de mention séparé peut toujours
// être ajouté à la main dans Linear pour abonner ces personnes au ticket.
export function parseContributors(description, users) {
  const userIds = [];
  const unresolved = [];
  const line = description?.match(CONTRIB_RE);
  if (!line) return { userIds, unresolved };
  for (const [, token] of line[1].matchAll(MENTION_RE)) {
    const user = resolveMention(token, users);
    if (!user) unresolved.push(token);
    else if (!userIds.includes(user.id)) userIds.push(user.id);
  }
  return { userIds, unresolved };
}

export function setStartingDate(description, isoDate) {
  const [y, mo, d] = isoDate.split('-');
  const line = `Starting date: ${d}/${mo}/${y}`;
  if (!description) return line;
  if (START_RE.test(description)) return description.replace(START_RE, line);
  if (START_LABEL_RE.test(description)) return description.replace(START_LABEL_RE, line);
  return `${line}\n\n${description}`;
}

// Remplace (ou retire, si users est vide) la ligne « Contributors » de la
// description, sans toucher au reste — même logique que setStartingDate.
export function setContributors(description, users) {
  const hasLine = Boolean(description) && CONTRIB_RE.test(description);
  if (users.length === 0) {
    if (!hasLine) return description ?? '';
    return description.replace(CONTRIB_RE, '').replace(/\n{2,}/g, '\n').trim();
  }
  const line = `Contributors: ${users.map((u) => `@${u.displayName ?? u.name}`).join(' ')}`;
  if (!description) return line;
  if (hasLine) return description.replace(CONTRIB_RE, line);
  return `${description}\n\n${line}`;
}
