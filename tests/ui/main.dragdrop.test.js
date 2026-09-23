// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const html = readFileSync(resolve(process.cwd(), 'src/ui/index.html'), 'utf8');
const bodyHtml = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

let domain;
let calls;
let handlers;

// Les écritures partent directement vers Linear (clé de l'utilisateur) : on les
// enregistre comme des appels « LINEAR » ; le backend ne reçoit que la relecture.
function fakeFetch(url, init = {}) {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (url.includes('api.linear.app')) {
    const op = /mutation\s+(\w+)/.exec(body.query)?.[1];
    calls.push({ method: 'LINEAR', op, variables: body.variables });
    return Promise.resolve({ status: 200, json: async () => ({ data: {
      issueUpdate: { success: true, issue: {} },
      projectMilestoneUpdate: { success: true, projectMilestone: {} },
    } }) });
  }
  calls.push({ method, url, body });
  const key = `${method} ${url.split('?')[0]}`;
  const handler = Object.entries(handlers).find(([k]) => (k.endsWith('*') ? key.startsWith(k.slice(0, -1)) : k === key));
  const data = handler ? handler[1](body) : {};
  return Promise.resolve({ status: 200, json: async () => data });
}

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function pointer(type, target, { x = 0, id = 1 } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  target.dispatchEvent(e);
  return e;
}

async function boot() {
  vi.resetModules();
  document.body.innerHTML = bodyHtml;
  localStorage.setItem('planning.linearKey', 'k');
  location.hash = '#/';
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  window.print = () => {};
  await import('../../src/ui/main.js');
  await flush();
}

beforeEach(() => {
  domain = mapWorkspace(rawWorkspace());
  calls = [];
  handlers = {
    'GET /api/snapshot': () => ({ version: 1, fetchedAt: 'x', stale: false, lastError: null, domain }),
    'GET /api/planning': () => ({
      settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
      holidays: [], people: [], weeklyCapacities: [], contributions: [],
    }),
    'POST /api/refresh': () => ({ version: 2, fetchedAt: 'x', stale: false, lastError: null, domain }),
  };
  vi.stubGlobal('fetch', fakeFetch);
});

describe('jalons — glisser-déposer dans l\'application montée', () => {
  it('affiche les jalons de la frise', async () => {
    await boot();
    expect(document.querySelector('.jd[data-milestone="m-1"]')).not.toBeNull();
  });

  it('glisser un jalon envoie la nouvelle date à l\'API', async () => {
    await boot();
    const diamond = document.querySelector('.jd[data-milestone="m-1"]');
    pointer('pointerdown', diamond, { x: 100 });
    pointer('pointermove', diamond, { x: 100 + 3 * 60 });
    pointer('pointerup', diamond, { x: 100 + 3 * 60 });
    await flush();
    const put = calls.find((c) => c.op === 'ProjectMilestoneUpdate' && c.variables.id === 'm-1');
    expect(put, JSON.stringify(calls)).toBeDefined();
    expect(put.variables.input.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(put.variables.input.targetDate).not.toBe('2026-11-05');
    expect(calls.some((c) => c.method === 'PUT' && c.url.startsWith('/api/milestones'))).toBe(false);
  });

  it('« Annuler » après un déplacement remet l\'ancienne date chez Linear', async () => {
    await boot();
    const diamond = document.querySelector('.jd[data-milestone="m-1"]');
    pointer('pointerdown', diamond, { x: 100 });
    pointer('pointermove', diamond, { x: 100 + 3 * 60 });
    pointer('pointerup', diamond, { x: 100 + 3 * 60 });
    await flush();
    const undoButton = document.querySelector('[data-action="undo"]');
    expect(undoButton, 'le bandeau d\'annulation doit apparaître').not.toBeNull();
    undoButton.click();
    await flush();
    const puts = calls.filter((c) => c.op === 'ProjectMilestoneUpdate' && c.variables.id === 'm-1');
    expect(puts).toHaveLength(2);
    expect(puts[1].variables.input.targetDate).toBe('2026-11-05');
  });

  it('pendant le glisser, le losange garde sa rotation (il reste un losange)', async () => {
    await boot();
    const diamond = document.querySelector('.jd[data-milestone="m-1"]');
    pointer('pointerdown', diamond, { x: 100 });
    pointer('pointermove', diamond, { x: 100 + 3 * 60 });
    expect(diamond.style.transform).toMatch(/translateX\(.+\)/);
    expect(diamond.style.transform).toMatch(/rotate\(45deg\)/);
  });

  it('glisser une tâche puis « Annuler » rejoue la date d\'origine (annulation des tâches aussi)', async () => {
    await boot();
    const bar = document.querySelector('.r.tk[data-t="i-11"] .bar');
    expect(bar).not.toBeNull();
    pointer('pointerdown', bar, { x: 100 });
    pointer('pointermove', bar, { x: 100 + 2 * 60 });
    pointer('pointerup', bar, { x: 100 + 2 * 60 });
    await flush();
    const ofI11 = () => calls.filter((c) => c.op === 'IssueUpdate' && c.variables.id === 'i-11');
    expect(ofI11()).toHaveLength(1);
    document.querySelector('[data-action="undo"]').click();
    await flush();
    const all = ofI11();
    expect(all).toHaveLength(2);
    expect(all[1].variables.input.dueDate).toBe('2026-09-25');
    expect(all[1].variables.input.description).toMatch(/Starting date: 16\/09\/2026/);
  });
});
