// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createRowSink, renderAxis, renderGrid, renderGroups, renderDependencies, renderIssueBar,
} from '../../src/ui/render/board.js';
import { createAxis } from '../../src/ui/render/layout.js';
import { buildView } from '../../src/ui/view.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const TODAY = '2026-09-17';

function draw({ collapsed = new Set(), mutate } = {}) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const planning = {
    settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
    holidays: [], people: [], weeklyCapacities: [], contributions: [],
  };
  const holidays = new Set();
  const view = buildView(domain, { route: { view: 'global', teamKey: null }, showCanceled: false });
  const axis = createAxis({ from: '2026-09-14', to: '2026-11-08' }, 10);
  const load = computeLoad(domain, planning, { range: axis, teamId: null });
  const leftRows = document.createElement('div');
  const rightRows = document.createElement('div');
  const sink = createRowSink(leftRows, rightRows);
  const { rowY, colorOf } = renderGroups(sink, {
    view, axis, holidays, load, users: domain.users, collapsed, selectedIssueId: null,
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  renderDependencies(svg, { rowY, colorOf, issues: domain.issues, conflicts: view.conflicts, axis, height: sink.top });
  const grid = document.createElement('div');
  renderGrid(grid, axis, holidays, TODAY, sink.top);
  const axisEl = document.createElement('div');
  renderAxis(axisEl, axis, TODAY);
  const row = (side, id) => side.querySelector(`.r.tk[data-t="${id}"]`);
  return { leftRows, rightRows, svg, grid, axisEl, rowY, sink, row };
}

describe('board', () => {
  it('dessine une ligne par issue planifiée, alignée à gauche et à droite', () => {
    const d = draw();
    expect(d.leftRows.querySelectorAll('.r.tk')).toHaveLength(3);
    expect(d.rightRows.querySelectorAll('.r.tk')).toHaveLength(3);
    expect(d.rowY).toEqual({ 'i-11': 70, 'i-12': 94, 'i-20': 176 });
    expect(d.sink.top).toBe(218);
    expect(d.leftRows.querySelector('.r.tb a').getAttribute('href')).toBe('#/team/IOT');
    expect([...d.leftRows.querySelectorAll('.r.p .pn')].map((e) => e.textContent))
      .toEqual(['Réalisation POC v1', 'Sans projet']);
  });

  it('propose d’ajouter une tâche par bloc et un projet par team', () => {
    const d = draw();
    const teamBtn = d.leftRows.querySelector('.r.tb [data-action="add-project"]');
    expect(teamBtn.dataset.team).toBe('t-iot');
    const projectBtn = [...d.leftRows.querySelectorAll('.r.p [data-action="add-task"]')]
      .find((b) => b.closest('.r.p').querySelector('.pn').textContent === 'Réalisation POC v1');
    expect(projectBtn.dataset.team).toBe('t-iot');
    expect(projectBtn.dataset.project).toBe('p-poc1');
    const noProjectBtn = [...d.leftRows.querySelectorAll('.r.p [data-action="add-task"]')]
      .find((b) => b.closest('.r.p').querySelector('.pn').textContent === 'Sans projet');
    expect(noProjectBtn.dataset.project).toBe('');
  });

  it('propose d’ajouter une team, à la toute fin de la liste', () => {
    const d = draw();
    const rows = [...d.leftRows.children];
    const addTeamRow = rows.find((r) => r.querySelector('[data-action="add-team"]'));
    expect(addTeamRow).toBe(rows[rows.length - 1]);
  });

  it('coupe les barres aux week-ends et affiche durée et heures', () => {
    const d = draw();
    const r = d.row(d.rightRows, 'i-11');
    const bars = r.querySelectorAll('.bar');
    expect(bars).toHaveLength(2);
    expect(r.querySelectorAll('.gp')).toHaveLength(1);
    expect([bars[0].style.left, bars[0].style.width]).toEqual(['20px', '30px']);
    expect([bars[1].style.left, bars[1].style.width]).toEqual(['70px', '50px']);
    expect(bars[0].style.backgroundColor).toBe('rgb(13, 114, 120)');
    expect(bars[0].className).toBe('bar doing');
    expect(r.querySelector('.bl').textContent).toBe('8 j · 40 h');
  });

  it('pose une poignée de redimensionnement à chaque vraie extrémité de la barre', () => {
    const d = draw();
    const r = d.row(d.rightRows, 'i-11');
    const left = r.querySelector('.rsz-l');
    const right = r.querySelector('.rsz-r');
    expect(left.dataset.edge).toBe('start');
    expect(right.dataset.edge).toBe('end');
    // i-11 : 16/09 (index 2) → 25/09 (index 11), dayWidth 10px.
    expect(left.style.left).toBe('17px'); // xOf(start) - 3
    expect(right.style.left).toBe('117px'); // xOf(end) + dayWidth - 3
  });

  it('renderIssueBar reconstruit une barre en place (utilisé pendant l’aperçu de redimensionnement)', () => {
    const d = draw();
    const r = d.row(d.rightRows, 'i-11');
    const axis = createAxis({ from: '2026-09-14', to: '2026-11-08' }, 10);
    renderIssueBar(r, { id: 'i-11', start: '2026-09-16', end: '2026-09-30', status: 'doing' }, {
      color: 'rgb(13, 114, 120)', status: 'doing', axis, holidays: new Set(),
    });
    const bars = r.querySelectorAll('.bar');
    // La barre s'étend maintenant jusqu'au 30/09 : plus de tronçons ouvrés
    // qu'avant, et les anciens éléments (bars/gaps/poignées) ont bien été
    // retirés plutôt que de s'accumuler.
    expect(bars.length).toBeGreaterThan(1);
    expect(r.querySelectorAll('.rsz-l')).toHaveLength(1);
    expect(r.querySelectorAll('.rsz-r')).toHaveLength(1);
    expect(r.querySelector('.rsz-r').style.left).toBe('167px'); // xOf('2026-09-30')=16*10 + dayWidth - 3
  });

  it('couvre aussi les extrémités qui tombent un jour chômé, pas seulement l’entre-deux', () => {
    // barSegments ne couvre que les jours ouvrés : une tâche qui commence ou
    // finit un samedi/dimanche n'a aucun tronçon travaillé à cet endroit, et
    // sans ce correctif ces bouts n'étaient couverts par rien du tout (ni
    // barre ni pointillé), pas juste transparents.
    const d = draw({ mutate: (raw) => {
      raw.issues[0].description = 'Starting date: 19/09/2026'; // samedi
      raw.issues[0].dueDate = '2026-09-27'; // dimanche
    } });
    const r = d.row(d.rightRows, 'i-11');
    expect(r.querySelectorAll('.bar')).toHaveLength(1);
    const gaps = [...r.querySelectorAll('.gp')];
    expect(gaps).toHaveLength(2);
    expect([gaps[0].style.left, gaps[0].style.width]).toEqual(['50px', '20px']);
    expect([gaps[1].style.left, gaps[1].style.width]).toEqual(['120px', '20px']);
  });

  it('résume statut, équipe et taux d’affectation', () => {
    const d = draw();
    const l = d.row(d.leftRows, 'i-11');
    expect(l.querySelector('.pill').textContent).toBe('En cours');
    expect(l.querySelector('.id').textContent).toBe('IOT-11');
    expect(l.querySelector('.tm').textContent).toBe('S 45% · L 45%');
    expect(l.querySelector('.pts').textContent).toBe('8');
    expect([...l.querySelectorAll('.dt')].map((e) => e.textContent)).toEqual(['16/09', '25/09']);
  });

  it('signale les contributeurs à vérifier, l’estimation absente et les tâches terminées', () => {
    const d = draw();
    const l = d.row(d.leftRows, 'i-20');
    expect(l.querySelector('.flag').textContent).toBe('!');
    expect(l.querySelector('.pill').textContent).toBe('Terminé');
    expect(l.querySelector('.pts').textContent).toBe('—');
    expect(l.querySelector('.pts').classList.contains('none')).toBe(true);
    expect(d.row(d.rightRows, 'i-20').querySelector('.bl').textContent.startsWith('✓ ')).toBe(true);
    expect(d.row(d.leftRows, 'i-11').querySelector('.flag').textContent).toBe('');
  });

  it('place les jalons', () => {
    const d = draw();
    const diamonds = d.rightRows.querySelectorAll('.jd');
    expect(diamonds).toHaveLength(1);
    expect(diamonds[0].style.left).toBe('525px');
    expect(d.rightRows.querySelector('.jt').textContent).toBe('Objet construit · 5/11');
    expect(d.rightRows.querySelectorAll('.jl')).toHaveLength(1);
    expect(diamonds[0].dataset.milestone).toBe('m-1');
    expect(d.rightRows.querySelector('.jl').dataset.milestone).toBe('m-1');
    expect(d.rightRows.querySelector('.jt').dataset.milestone).toBe('m-1');
  });

  it('relie les dépendances et signale un conflit en rouge pointillé', () => {
    const ok = draw().svg.querySelectorAll('polyline');
    expect(ok).toHaveLength(1);
    expect(ok[0].dataset.from).toBe('i-11');
    expect(ok[0].dataset.to).toBe('i-12');
    expect(ok[0].getAttribute('stroke-dasharray')).toBeNull();

    const d = draw({ mutate: (raw) => { raw.issues[1].description = 'Starting date: 24/09/2026'; } });
    const line = d.svg.querySelector('polyline');
    expect(line.getAttribute('stroke-dasharray')).toBe('3 2');
    expect(line.getAttribute('stroke')).toBe('#AE2C34');
    expect(d.row(d.leftRows, 'i-12').querySelector('.pill').textContent).toBe('Bloqué');
    expect(d.row(d.rightRows, 'i-12').querySelector('.bar').className).toBe('bar block');
  });

  it('replie un projet', () => {
    const d = draw({ collapsed: new Set(['t-iot:p-poc1']) });
    expect([...d.leftRows.querySelectorAll('.r.tk')].map((r) => r.dataset.t)).toEqual(['i-20']);
    expect(d.leftRows.querySelector('[data-tog="t-iot:p-poc1"]').closest('.r').classList.contains('op')).toBe(false);
    expect(d.svg.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('dessine grille, jours non ouvrés, débuts de mois et ligne du jour', () => {
    const d = draw();
    expect(d.grid.style.height).toBe('218px');
    expect(d.grid.querySelectorAll('.o')).toHaveLength(16);
    expect(d.grid.querySelectorAll('.m')).toHaveLength(2);
    expect(d.grid.querySelector('.td').style.left).toBe('35px');
    expect(d.axisEl.querySelector('.today-tag').textContent).toBe('Aujourd\'hui');
    expect(d.axisEl.querySelector('.mo').firstElementChild.textContent).toBe('septembre 2026');
  });

  it('ouvre son propre panneau depuis n’importe quel point de la ligne', () => {
    const d = draw();
    const parentRow = d.row(d.leftRows, 'i-11');
    expect(parentRow.dataset.open).toBe('i-11');
    expect(d.row(d.rightRows, 'i-11').dataset.open).toBe('i-11');
  });

  it('imbrique une sous-issue directement sous sa parente, avec un contour cliquable', () => {
    const d = draw();
    const parentRow = d.row(d.leftRows, 'i-11');
    const childRow = d.row(d.leftRows, 'i-12');
    expect(childRow.classList.contains('sub')).toBe(true);
    expect(parentRow.classList.contains('sub')).toBe(false);
    expect(childRow.dataset.open).toBe('i-11');
    expect(childRow.querySelector('.id').style.paddingLeft).toBe('14px');
    // La zone vide de la ligne ouvre la parente, mais le badge équipe garde
    // son propre data-open vers la sous-issue elle-même.
    expect(childRow.querySelector('.tm').dataset.open).toBe('i-12');
    const childRight = d.row(d.rightRows, 'i-12');
    expect(childRight.dataset.open).toBe('i-11');
    expect(childRight.querySelector('.bar').dataset.open).toBe('i-12');
  });

  it('trie les racines par date de début, mais termine le fil d’une dépendance avant de passer à la suivante', () => {
    // i-12 (28/09) dépend de i-11 (16/09), donc reste juste après lui même si
    // une 3e issue du même bloc, sans dépendance, démarre plus tôt (20/09).
    const d = draw({ mutate: (raw) => {
      raw.issues.push({
        id: 'i-14', identifier: 'IOT-14', title: 'Racine intercalée', team: { id: 't-iot' }, project: { id: 'p-poc1' },
        description: 'Starting date: 20/09/2026', dueDate: '2026-09-24', estimate: 2,
        state: { type: 'unstarted' }, assignee: null, parent: null,
        relations: { nodes: [] }, inverseRelations: { nodes: [] }, comments: { nodes: [] },
      });
    } });
    const order = [...d.leftRows.querySelectorAll('.r.tk')].map((r) => r.dataset.t);
    const poc1Order = order.filter((id) => ['i-11', 'i-12', 'i-14'].includes(id));
    expect(poc1Order).toEqual(['i-11', 'i-12', 'i-14']);
  });

  it('trie deux racines indépendantes du même bloc par date de début', () => {
    const d = draw({ mutate: (raw) => {
      raw.issues.push({
        id: 'i-15', identifier: 'IOT-15', title: 'Racine plus tôt', team: { id: 't-iot' }, project: { id: 'p-poc1' },
        description: 'Starting date: 10/09/2026', dueDate: '2026-09-14', estimate: 1,
        state: { type: 'unstarted' }, assignee: null, parent: null,
        relations: { nodes: [] }, inverseRelations: { nodes: [] }, comments: { nodes: [] },
      });
    } });
    const order = [...d.leftRows.querySelectorAll('.r.tk')].map((r) => r.dataset.t);
    expect(order.indexOf('i-15')).toBeLessThan(order.indexOf('i-11'));
  });

  it('place une dépendante juste sous sa bloqueuse même sans lien parent/sous-issue', () => {
    // i-20 (WEB, hors projet) ne dépend de rien dans le fixture de base ;
    // on le fait dépendre d'une nouvelle issue postérieure dans le même
    // bloc pour vérifier que la chaîne de dépendances prime sur la seule
    // date de début.
    const d = draw({ mutate: (raw) => {
      raw.issues.push({
        id: 'i-21', identifier: 'WEB-2', title: 'Avant mais bloquante', team: { id: 't-web' },
        description: 'Starting date: 10/09/2026', dueDate: '2026-09-12', estimate: 1,
        state: { type: 'unstarted' }, assignee: null, project: null, parent: null,
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'i-20' } }] },
        inverseRelations: { nodes: [] }, comments: { nodes: [] },
      });
    } });
    const order = [...d.leftRows.querySelectorAll('.r.tk')].map((r) => r.dataset.t);
    const idx21 = order.indexOf('i-21');
    const idx20 = order.indexOf('i-20');
    expect(idx20).toBe(idx21 + 1);
    // Pas de rattachement visuel : ce n'est pas une sous-issue, la ligne
    // ouvre donc sa propre issue (comme toute ligne racine).
    expect(d.row(d.leftRows, 'i-20').classList.contains('sub')).toBe(false);
    expect(d.row(d.leftRows, 'i-20').dataset.open).toBe('i-20');
  });

  it(`ne rattache pas une sous-issue dont la parente n'est pas dans le même bloc`, () => {
    const d = draw({ mutate: (raw) => { raw.issues[1].parent = { id: 'i-20' }; } });
    // i-20 est dans un autre projet/équipe : i-12 reste au niveau racine.
    const childRow = d.row(d.leftRows, 'i-12');
    expect(childRow.classList.contains('sub')).toBe(false);
    expect(childRow.dataset.open).toBe('i-12');
  });

  it('échappe les textes venus de Linear', () => {
    const d = draw({ mutate: (raw) => { raw.issues[0].title = '<img src=x onerror=alert(1)>'; } });
    const l = d.row(d.leftRows, 'i-11');
    expect(l.querySelector('.nmw').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(l.querySelector('img')).toBeNull();
  });
});
