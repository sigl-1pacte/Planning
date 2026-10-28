// Filtres de la frise et du kanban, et vues (filtres enregistrés). Un filtre
// est un objet simple, enregistrable tel quel (préférences du navigateur,
// vues de chacun sur le serveur) :
//  - people : ids Linear, 'me' (la personne connectée) ou 'nobody' (sans
//    contributeur) ;
//  - projects : ids de projet, ou 'none' (sans projet) ;
//  - due : null, ou l'une des clés de DUE ;
//  - q : texte cherché dans l'identifiant et le titre.
// Dans un même critère, une valeur suffit ; entre critères, tous comptent.
import { addDays, mondayOf } from './calendar.js';

export const EMPTY_FILTER = Object.freeze({ people: [], projects: [], due: null, q: '' });

export const DUE = [
  { key: 'overdue', label: 'En retard' },
  { key: 'week', label: 'Cette semaine' },
  { key: 'two-weeks', label: '2 prochaines semaines' },
  { key: 'unplanned', label: 'Non planifiées' },
];

// Vues par défaut, les mêmes pour tout le monde. Les vues de chacun
// s'ajoutent à côté.
export const PRESETS = [
  { id: 'preset:mine', name: 'Mes tâches', filter: { ...EMPTY_FILTER, people: ['me'] } },
  { id: 'preset:overdue', name: 'En retard', filter: { ...EMPTY_FILTER, due: 'overdue' } },
  { id: 'preset:week', name: 'Cette semaine', filter: { ...EMPTY_FILTER, due: 'week' } },
  { id: 'preset:nobody', name: 'Sans contributeur', filter: { ...EMPTY_FILTER, people: ['nobody'] } },
];

const strings = (list) => (Array.isArray(list) ? [...new Set(list.filter((v) => typeof v === 'string' && v))].sort() : []);

// Toute valeur venue d'ailleurs (préférences, serveur) passe par ici.
export function normalizeFilter(f) {
  return {
    people: strings(f?.people),
    projects: strings(f?.projects),
    due: DUE.some((d) => d.key === f?.due) ? f.due : null,
    q: typeof f?.q === 'string' ? f.q.trim().slice(0, 200) : '',
  };
}

export const isEmptyFilter = (f) => {
  const n = normalizeFilter(f);
  return !n.people.length && !n.projects.length && !n.due && !n.q;
};

export const sameFilter = (a, b) => JSON.stringify(normalizeFilter(a)) === JSON.stringify(normalizeFilter(b));

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Prédicat (issue) → booléen, ou null pour un filtre vide. `me` : id Linear de
// la personne connectée (null si inconnu : « moi » ne correspond alors à rien).
export function issueFilter(filter, { me, today }) {
  const f = normalizeFilter(filter);
  if (isEmptyFilter(f)) return null;
  const people = new Set(f.people.map((p) => (p === 'me' ? me : p)).filter(Boolean));
  const nobody = f.people.includes('nobody');
  const projects = new Set(f.projects);
  const q = fold(f.q);
  const monday = mondayOf(today);
  const due = {
    overdue: (i) => i.status !== 'done' && i.status !== 'canceled' && Boolean(i.end) && i.end < today,
    week: (i) => Boolean(i.start) && i.start <= addDays(monday, 6) && i.end >= monday,
    'two-weeks': (i) => Boolean(i.start) && i.start <= addDays(today, 13) && i.end >= today,
    unplanned: (i) => !i.start,
  }[f.due];
  return (i) => (!f.people.length || (nobody && !i.contributorIds.length) || i.contributorIds.some((id) => people.has(id)))
    && (!f.projects.length || projects.has(i.projectId ?? 'none'))
    && (!due || due(i))
    && (!q || fold(i.identifier).includes(q) || fold(i.title).includes(q));
}

// Résumé lisible d'un filtre, pour l'export Markdown.
export function describeFilter(filter, domain) {
  const f = normalizeFilter(filter);
  const name = (id) => ({ me: 'moi', nobody: 'personne' }[id] ?? domain.users.find((u) => u.id === id)?.name ?? '?');
  const project = (id) => (id === 'none' ? 'sans projet' : domain.projects.find((p) => p.id === id)?.name ?? '?');
  return [
    f.people.length ? `personne : ${f.people.map(name).join(', ')}` : null,
    f.projects.length ? `projet : ${f.projects.map(project).join(', ')}` : null,
    f.due ? `échéance : ${DUE.find((d) => d.key === f.due).label.toLowerCase()}` : null,
    f.q ? `recherche : « ${f.q} »` : null,
  ].filter(Boolean).join(' · ');
}
