import { describe, it, expect } from 'vitest';
import { buildView, rangeFor } from '../../src/ui/view.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const domain = () => mapWorkspace(rawWorkspace());
const global = { view: 'global', teamKey: null };

describe('buildView', () => {
  it("regroupe par team puis par projet, et met à part les issues non planifiées", () => {
    const v = buildView(domain(), { route: global, showCanceled: false });
    expect(v.notFound).toBe(false);
    expect(v.teamId).toBeNull();
    expect(v.groups.map((g) => g.team.key)).toEqual(['IOT', 'WEB']);
    expect(v.groups[0].projects[0].project.id).toBe('p-poc1');
    expect(v.groups[0].projects[0].issues.map((i) => i.identifier)).toEqual(['IOT-11', 'IOT-12']);
    expect(v.groups[1].projects).toEqual([]);
    expect(v.groups[1].noProject.map((i) => i.identifier)).toEqual(['WEB-1']);
    expect(v.unplanned.map((i) => i.identifier)).toEqual(['IOT-13']);
  });

  it("restreint à une team", () => {
    const v = buildView(domain(), { route: { view: 'team', teamKey: 'WEB' }, showCanceled: false });
    expect(v.teamId).toBe('t-web');
    expect(v.groups.map((g) => g.team.key)).toEqual(['WEB']);
    expect(v.unplanned).toEqual([]);
  });

  it("signale une team inconnue", () => {
    const v = buildView(domain(), { route: { view: 'team', teamKey: 'NOPE' }, showCanceled: false });
    expect(v.notFound).toBe(true);
    expect(v.groups).toEqual([]);
  });

  it("masque les issues annulées sauf si la préférence le demande", () => {
    const raw = rawWorkspace();
    raw.issues[1].state.type = 'canceled';
    const d = mapWorkspace(raw);
    const hidden = buildView(d, { route: global, showCanceled: false });
    const shown = buildView(d, { route: global, showCanceled: true });
    expect(hidden.groups[0].projects[0].issues.map((i) => i.id)).toEqual(['i-11']);
    expect(shown.groups[0].projects[0].issues.map((i) => i.id)).toEqual(['i-11', 'i-12']);
  });

  it("range sous « sans projet » une issue dont le projet n'est pas rattaché à sa team", () => {
    const raw = rawWorkspace();
    raw.issues[3].project = { id: 'p-poc1' };
    const v = buildView(mapWorkspace(raw), { route: global, showCanceled: false });
    expect(v.groups[1].noProject.map((i) => i.id)).toEqual(['i-20']);
  });

  it("liste les contributeurs du périmètre, triés par nom", () => {
    const v = buildView(domain(), { route: global, showCanceled: false });
    expect(v.people.map((u) => u.name)).toEqual(['Louis', 'Sacha']);
    const web = buildView(domain(), { route: { view: 'team', teamKey: 'WEB' }, showCanceled: false });
    expect(web.people).toEqual([]);
  });

  it("calcule conflits et cycles", () => {
    const raw = rawWorkspace();
    raw.issues[1].description = 'Starting date: 24/09/2026';
    const v = buildView(mapWorkspace(raw), { route: global, showCanceled: false });
    expect(v.conflicts).toEqual([{ issueId: 'i-12', blockerId: 'i-11' }]);
    expect(v.cycles).toEqual([]);
  });
});

describe('rangeFor', () => {
  it("se cale sur le périmètre de la vue", () => {
    const d = domain();
    expect(rangeFor(d, buildView(d, { route: global, showCanceled: false }), '2026-09-14'))
      .toEqual({ from: '2026-09-14', to: '2026-11-08' });
    expect(rangeFor(d, buildView(d, { route: { view: 'team', teamKey: 'WEB' }, showCanceled: false }), '2026-09-14'))
      .toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it("montre quatre semaines à partir du lundi courant quand rien n'est daté", () => {
    const d = { teams: [], users: [], projects: [], issues: [] };
    expect(rangeFor(d, buildView(d, { route: global, showCanceled: false }), '2026-09-16'))
      .toEqual({ from: '2026-09-14', to: '2026-10-11' });
  });
});
