// Vues enregistrées de chacun : des filtres de la frise et du kanban
// (src/shared/filters.js), nommés, propres à la personne connectée. Chaque
// fonction prend l'id Linear du propriétaire : on ne lit ni ne modifie
// jamais la vue d'un autre.
import { DUE, normalizeFilter } from '../../shared/filters.js';

export const MAX_VIEWS = 30;

const ids = { type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 100 } };
const filterSchema = {
  type: 'object', required: ['people', 'projects', 'due', 'q'], additionalProperties: false,
  properties: { people: ids, projects: ids, due: { enum: [null, ...DUE.map((d) => d.key)] }, q: { type: 'string', maxLength: 200 } },
};
const name = { type: 'string', minLength: 1, maxLength: 60 };
export const viewBody = {
  type: 'object', required: ['name', 'filter'], additionalProperties: false, properties: { name, filter: filterSchema },
};
export const viewPatchBody = {
  type: 'object', minProperties: 1, additionalProperties: false, properties: { name, filter: filterSchema },
};

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function cleanName(value) {
  const n = value.trim();
  if (!n) throw fail('Le nom de la vue est obligatoire', 400);
  return n;
}

// L'index unique (propriétaire, nom sans casse) refuse un doublon.
async function named(fn, viewName) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw fail(`Vous avez déjà une vue « ${viewName} »`, 409);
    throw err;
  }
}

// Ids en texte côté interface ; un id qui n'est pas un entier n'existe pas.
const viewId = (id) => {
  if (!/^\d{1,18}$/.test(String(id))) throw fail('Vue introuvable', 404);
  return String(id);
};

export async function listViews(db, owner) {
  const { rows } = await db.query(
    'select id, name, filter from saved_view where owner_user_id = $1 order by created_at, id',
    [owner],
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name, filter: normalizeFilter(r.filter) }));
}

export async function createView(db, owner, body) {
  const n = cleanName(body.name);
  const { rows: [{ count }] } = await db.query('select count(*)::int as count from saved_view where owner_user_id = $1', [owner]);
  if (count >= MAX_VIEWS) throw fail(`${MAX_VIEWS} vues au plus : supprimez-en une d'abord`, 400);
  const { rows } = await named(() => db.query(
    'insert into saved_view (owner_user_id, name, filter) values ($1, $2, $3::jsonb) returning id',
    [owner, n, JSON.stringify(normalizeFilter(body.filter))],
  ), n);
  return String(rows[0].id);
}

export async function updateView(db, owner, id, patch) {
  const n = 'name' in patch ? cleanName(patch.name) : null;
  const { rows } = await named(() => db.query(
    `update saved_view set name = coalesce($3, name), filter = coalesce($4::jsonb, filter)
     where id = $1 and owner_user_id = $2 returning id`,
    [viewId(id), owner, n, 'filter' in patch ? JSON.stringify(normalizeFilter(patch.filter)) : null],
  ), n);
  if (!rows.length) throw fail('Vue introuvable', 404);
}

export async function deleteView(db, owner, id) {
  const { rows } = await db.query('delete from saved_view where id = $1 and owner_user_id = $2 returning id', [viewId(id), owner]);
  if (!rows.length) throw fail('Vue introuvable', 404);
}
