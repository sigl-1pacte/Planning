// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { orgModel, orgLayout, renderOrgChart } from '../../src/ui/render/orgChart.js';

const users = [
  { id: 'u1', name: 'Alice', active: true },
  { id: 'u2', name: 'Bruno', active: true },
  { id: 'u3', name: 'Chloé', active: true },
  { id: 'u4', name: 'Damien', active: false },
  { id: 'u5', name: 'Emma', active: true },
];
const domain = {
  users,
  teams: [
    { id: 't1', key: 'IOT', name: 'IoT', memberIds: ['u1', 'u2', 'u3', 'u4'] },
    { id: 't2', key: 'WEB', name: 'Web', memberIds: ['u3'] },
  ],
};
const planning = (teamRoles, managerUserId = null) => ({ org: { managerUserId, teamRoles } });

describe('orgModel', () => {
  it('sépare PO et SM des autres membres actifs, et note les autres teams de chacun', () => {
    const model = orgModel(domain, planning([
      { teamId: 't1', role: 'product_owner', linearUserId: 'u1' },
      { teamId: 't1', role: 'scrum_master', linearUserId: 'u2' },
      // Hors membres Linear de la team : apparaît quand même, avec son rôle.
      { teamId: 't2', role: 'product_owner', linearUserId: 'u5' },
    ], 'u5'));
    expect(model.manager.name).toBe('Emma');
    const [iot, web] = model.teams;
    expect([iot.po.name, iot.sm.name, iot.members.map((u) => u.name)]).toEqual(['Alice', 'Bruno', ['Chloé']]);
    expect([web.po.name, web.sm, web.members.map((u) => u.name)]).toEqual(['Emma', null, ['Chloé']]);
    expect(model.teamKeysOf.get('u3')).toEqual(['IOT', 'WEB']);
  });

  it('tolère une planification sans organisation et des teams sans membres connus', () => {
    const model = orgModel({ users, teams: [{ id: 't9', key: 'X', name: 'X' }] }, {});
    expect(model.manager).toBeNull();
    expect(model.teams[0]).toMatchObject({ po: null, sm: null, members: [] });
  });
});

describe('orgLayout', () => {
  it('relie PO et SM distincts, et un seul nœud quand la même personne tient les deux rôles', () => {
    const layout = orgLayout(orgModel(domain, planning([
      { teamId: 't1', role: 'product_owner', linearUserId: 'u1' },
      { teamId: 't1', role: 'scrum_master', linearUserId: 'u2' },
      { teamId: 't2', role: 'product_owner', linearUserId: 'u3' },
      { teamId: 't2', role: 'scrum_master', linearUserId: 'u3' },
    ])));
    const [iot, web] = layout.clusters;
    expect(iot.edge).not.toBeNull();
    expect(iot.nodes.map((n) => [n.user.name, n.roles])).toEqual([
      ['Alice', ['product_owner']], ['Bruno', ['scrum_master']], ['Chloé', []],
    ]);
    expect(web.edge).toBeNull();
    expect(web.nodes).toHaveLength(1);
    expect(web.nodes[0].roles).toEqual(['product_owner', 'scrum_master']);
  });

  it('pas de lien tant qu’un des deux rôles manque', () => {
    const layout = orgLayout(orgModel(domain, planning([{ teamId: 't1', role: 'product_owner', linearUserId: 'u1' }])));
    expect(layout.clusters[0].edge).toBeNull();
    expect(layout.clusters[0].nodes[1]).toMatchObject({ user: null, roles: ['scrum_master'] });
  });

  it('range les grappes en colonnes selon la largeur', () => {
    const many = { users, teams: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, key: `T${i}`, name: `T${i}`, memberIds: [] })) };
    const wide = orgLayout(orgModel(many, {}), 1496);
    expect(new Set(wide.clusters.map((c) => c.x)).size).toBe(4);
    const narrow = orgLayout(orgModel(many, {}), 400);
    expect(new Set(narrow.clusters.map((c) => c.x)).size).toBe(1);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
});

describe('renderOrgChart', () => {
  it('rend manager, grappes, lien PO ↔ SM et cibles cliquables', () => {
    const el = document.createElement('div');
    renderOrgChart(el, { domain, planning: planning([
      { teamId: 't1', role: 'product_owner', linearUserId: 'u1' },
      { teamId: 't1', role: 'scrum_master', linearUserId: 'u2' },
    ]) });
    expect(el.querySelectorAll('.org-team')).toHaveLength(2);
    expect(el.querySelectorAll('.org-edge')).toHaveLength(1);
    expect(el.querySelector('[data-person="u1"]')).not.toBeNull();
    // Manager non choisi : nœud vide qui ouvre le panneau de toute l'organisation.
    expect(el.querySelector('.org-node.empty[data-org-roles=""]')).not.toBeNull();
    expect(el.querySelector('.org-head[data-org-roles="t2"]')).not.toBeNull();
    expect(el.querySelector('[data-person="u4"]')).toBeNull();
  });
});
