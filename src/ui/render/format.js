export const STATUS = {
  todo: { label: 'À faire', color: '#8B98A3' },
  doing: { label: 'En cours', color: '#B9700A' },
  done: { label: 'Terminé', color: '#2C7A5C' },
  canceled: { label: 'Annulée', color: '#5E6A73' },
  blocked: { label: 'Bloqué', color: '#AE2C34' },
};

const PERSON_PALETTE = ['#2F4858', '#33658A', '#0D7278', '#7A5195', '#B9700A', '#A02E5A', '#3F7A3A', '#8A5A2B'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

export function initials(user) {
  const letters = (user?.name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('');
  return letters.toUpperCase() || '??';
}

export function personColor(userId, users) {
  const i = users.findIndex((u) => u.id === userId);
  return PERSON_PALETTE[Math.max(0, i) % PERSON_PALETTE.length];
}

export const fr1 = (n) => n.toFixed(1).replace('.', ',');

export function shortDay(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${m}`;
}

export function longDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function issueStatus(issue, blockedIds) {
  const closed = issue.status === 'done' || issue.status === 'canceled';
  return !closed && blockedIds.has(issue.id) ? 'blocked' : issue.status;
}
