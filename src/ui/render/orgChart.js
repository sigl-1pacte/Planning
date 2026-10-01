// src/ui/render/orgChart.js
// Vue « Organisation » : le manager en tête, puis une grappe par team avec
// ses membres Linear. Le Product Owner et le Scrum Master de chaque team sont
// en haut de leur grappe, reliés entre eux ; les autres membres en dessous.
// Une personne présente dans plusieurs teams apparaît dans chacune, avec la
// liste de ses autres teams sous son nom.
import { esc, initials, personColor } from './format.js';

const NODE_W = 104;
const NODE_H = 80;
const PAD = 16;
const HEAD = 40;
const GAP = 24;
const COLS = 3;
const CLUSTER_W = COLS * NODE_W + 2 * PAD;
const TOP = 132;
// Largeur par défaut (feuille de 1540 px moins ses marges), quand celle de la
// page n'est pas mesurable.
const LAYOUT_WIDTH = 1496;

const ROLE_LABEL = { product_owner: 'PO', scrum_master: 'SM' };
const byName = (a, b) => a.name.localeCompare(b.name, 'fr');

export function orgModel(domain, planning) {
  const users = new Map(domain.users.map((u) => [u.id, u]));
  const org = planning.org ?? { managerUserId: null, teamRoles: [] };
  const holder = (teamId, role) => users.get(org.teamRoles.find((r) => r.teamId === teamId && r.role === role)?.linearUserId) ?? null;

  const teams = domain.teams.map((team) => {
    const po = holder(team.id, 'product_owner');
    const sm = holder(team.id, 'scrum_master');
    const members = (team.memberIds ?? [])
      .map((id) => users.get(id))
      .filter((u) => u && u.active && u !== po && u !== sm)
      .sort(byName);
    return { team, po, sm, members };
  });

  // Teams de chaque personne (membre ou titulaire d'un rôle), pour signaler
  // sous son nom celles où elle apparaît aussi.
  const teamKeysOf = new Map();
  for (const { team, po, sm, members } of teams) {
    for (const u of new Set([po, sm, ...members].filter(Boolean))) {
      if (!teamKeysOf.has(u.id)) teamKeysOf.set(u.id, []);
      teamKeysOf.get(u.id).push(team.key);
    }
  }
  return { manager: users.get(org.managerUserId) ?? null, teams, teamKeysOf };
}

// Positions (centres des nœuds) pour une largeur donnée : grappes réparties en
// colonnes, chacune posée sous la colonne la moins haute.
export function orgLayout(model, width = LAYOUT_WIDTH) {
  const columns = Math.max(1, Math.min(model.teams.length, Math.floor((width + GAP) / (CLUSTER_W + GAP))));
  const totalWidth = columns * CLUSTER_W + (columns - 1) * GAP;
  const columnBottom = Array(columns).fill(TOP);

  const clusters = model.teams.map(({ team, po, sm, members }) => {
    const rows = Math.ceil(members.length / COLS);
    const height = HEAD + NODE_H + (rows ? 14 + rows * NODE_H : 0) + PAD;
    const column = columnBottom.indexOf(Math.min(...columnBottom));
    const x = column * (CLUSTER_W + GAP);
    const y = columnBottom[column];
    columnBottom[column] += height + GAP;

    const roleY = y + HEAD + 26;
    const nodes = [];
    if (po && po === sm) {
      nodes.push({ user: po, roles: ['product_owner', 'scrum_master'], cx: x + CLUSTER_W / 2, cy: roleY });
    } else {
      nodes.push({ user: po, roles: ['product_owner'], cx: x + PAD + NODE_W / 2, cy: roleY });
      nodes.push({ user: sm, roles: ['scrum_master'], cx: x + CLUSTER_W - PAD - NODE_W / 2, cy: roleY });
    }
    members.forEach((user, i) => {
      nodes.push({
        user,
        roles: [],
        cx: x + PAD + NODE_W * ((i % COLS) + 0.5),
        cy: y + HEAD + NODE_H + 14 + Math.floor(i / COLS) * NODE_H + 26,
      });
    });
    const edge = po && sm && po !== sm ? { x1: nodes[0].cx, x2: nodes[1].cx, y: roleY } : null;
    return { team, x, y, width: CLUSTER_W, height, separatorY: rows ? y + HEAD + NODE_H + 4 : null, nodes, edge };
  });

  return {
    width: totalWidth,
    height: Math.max(TOP, ...columnBottom) - (model.teams.length ? GAP : 0),
    manager: { user: model.manager, cx: totalWidth / 2, cy: 54 },
    clusters,
  };
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function badge(cx, cy, text, cls) {
  const w = 10 + text.length * 6.2;
  return `<g class="org-badge ${cls}"><rect x="${cx - w / 2}" y="${cy - 8}" width="${w}" height="16" rx="8"/>
    <text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${esc(text)}</text></g>`;
}

function personNode({ user, roles, cx, cy }, { users, teamKeysOf, teamKey, radius = 20, label = null, rolesTarget }) {
  const roleText = roles.map((r) => ROLE_LABEL[r]).join(' · ');
  if (!user) {
    return `<g class="org-node empty" data-org-roles="${esc(rolesTarget)}">
      <title>${label ? 'Choisir le manager' : `Choisir le ${roleText === 'PO' ? 'Product Owner' : 'Scrum Master'}`}</title>
      <circle cx="${cx}" cy="${cy}" r="${radius}"/>
      <text class="ini" x="${cx}" y="${cy + 5}" text-anchor="middle">?</text>
      <text class="nm" x="${cx}" y="${cy + radius + 15}" text-anchor="middle">${esc(label ?? `${roleText} à définir`)}</text>
    </g>`;
  }
  const others = teamKey ? (teamKeysOf.get(user.id) ?? []).filter((k) => k !== teamKey) : [];
  return `<g class="org-node" data-person="${esc(user.id)}">
    <title>${esc(user.name)}${roleText ? ` — ${roleText}` : ''}</title>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${personColor(user.id, users)}"/>
    <text class="ini" x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(initials(user))}</text>
    <text class="nm" x="${cx}" y="${cy + radius + 15}" text-anchor="middle">${esc(truncate(user.name, 17))}</text>
    ${others.length ? `<text class="also" x="${cx}" y="${cy + radius + 28}" text-anchor="middle">aussi ${esc(others.join(', '))}</text>` : ''}
    ${label ? badge(cx, cy - radius - 4, label, 'mgr') : ''}
    ${roleText ? badge(cx + radius - 2, cy - radius + 2, roleText, roles.length > 1 ? 'both' : roles[0]) : ''}
  </g>`;
}

// Les grappes se répartissent sur la largeur réellement disponible : moins
// de colonnes sur un écran étroit plutôt qu'un dessin réduit illisible.
export function renderOrgChart(el, { domain, planning }) {
  const model = orgModel(domain, planning);
  const layout = orgLayout(model, el.clientWidth || LAYOUT_WIDTH);
  const users = domain.users;
  const parts = [];

  parts.push(personNode({ ...layout.manager, roles: [] }, {
    users, teamKeysOf: model.teamKeysOf, radius: 26, label: 'Manager', rolesTarget: '',
  }));

  for (const cluster of layout.clusters) {
    const { team, x, y, width, height } = cluster;
    parts.push(`<g class="org-team">
      <rect class="org-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
      <g class="org-head" data-org-roles="${esc(team.id)}"><title>Choisir le PO et le Scrum Master de ${esc(team.name)}</title>
        <rect x="${x}" y="${y}" width="${width}" height="${HEAD - 8}" rx="10" fill="transparent"/>
        <text class="tn" x="${x + PAD}" y="${y + 22}">${esc(team.name)}</text>
        <text class="tk" x="${x + width - PAD}" y="${y + 22}" text-anchor="end">${esc(team.key)} · rôles</text>
      </g>
      ${cluster.separatorY ? `<line class="org-sep" x1="${x + PAD}" x2="${x + width - PAD}" y1="${cluster.separatorY}" y2="${cluster.separatorY}"/>` : ''}
      ${cluster.edge ? `<line class="org-edge" x1="${cluster.edge.x1}" x2="${cluster.edge.x2}" y1="${cluster.edge.y}" y2="${cluster.edge.y}"><title>Binôme PO ↔ Scrum Master</title></line>` : ''}
      ${cluster.nodes.map((n) => personNode(n, { users, teamKeysOf: model.teamKeysOf, teamKey: team.key, rolesTarget: team.id })).join('')}
    </g>`);
  }

  el.innerHTML = `<div class="org-wrap">
    <p class="note">Membres de chaque team d'après Linear. Cliquez une personne pour sa fiche, l'en-tête d'une team pour choisir son Product Owner et son Scrum Master, et le manager pour le changer.</p>
    <svg class="org-svg" viewBox="0 0 ${layout.width} ${layout.height}" style="max-width:${layout.width}px">${parts.join('')}</svg>
    ${model.teams.length ? '' : '<p class="note">Aucune team dans le workspace Linear.</p>'}
  </div>`;
}
