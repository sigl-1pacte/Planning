// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPanels } from '../../src/ui/panels.js';
import { buildView } from '../../src/ui/view.js';
import { computeLoad } from '../../src/shared/load.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function context({ planningOver = {}, mutate } = {}) {
  const raw = rawWorkspace();
  mutate?.(raw);
  const domain = mapWorkspace(raw);
  const planning = {
    settings: { hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 },
    holidays: [{ day: '2026-11-11', label: 'Armistice' }],
    people: [], weeklyCapacities: [], contributions: [],
    ...planningOver,
  };
  const view = buildView(domain, { route: { view: 'global', teamKey: null }, showCanceled: false });
  const load = computeLoad(domain, planning, { range: { from: '2026-09-14', to: '2026-10-11' }, teamId: null });
  return { domain, planning, load, view, prefs: { showCanceled: false } };
}

function setup(ctx = context()) {
  const drawer = document.createElement('aside');
  const title = document.createElement('h3');
  const body = document.createElement('div');
  const closeButton = document.createElement('button');
  drawer.append(title, closeButton, body);
  document.body.append(drawer);
  const api = {
    setContributions: vi.fn(async () => ({})),
    clearContributions: vi.fn(async () => ({})),
    updatePerson: vi.fn(async () => ({})),
    setCapacity: vi.fn(async () => ({})),
    clearCapacity: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => ({})),
    addHoliday: vi.fn(async () => ({})),
    deleteHoliday: vi.fn(async () => ({})),
    updateIssue: vi.fn(async () => ({})),
    reschedule: vi.fn(async () => ({})),
    setDependencies: vi.fn(async () => ({})),
    setContributors: vi.fn(async () => ({})),
    createIssue: vi.fn(async () => ({})),
    updateProject: vi.fn(async () => ({})),
    createProject: vi.fn(async () => ({})),
    createTeam: vi.fn(async () => ({})),
  };
  const onMutate = vi.fn((call) => call(api));
  const onWrite = vi.fn((call) => call(api));
  const onPrefs = vi.fn();
  const onForgetKey = vi.fn();
  const panels = createPanels({ drawer, title, body, closeButton, onMutate, onPrefs, onForgetKey, onWrite });
  panels.update(ctx);
  return { drawer, title, body, closeButton, api, onMutate, onWrite, onPrefs, onForgetKey, panels };
}

const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const change = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => { document.body.innerHTML = ''; });

describe('panneau de tâche', () => {
  it('affiche les données Linear avec des champs éditables et les parts égales', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    expect(t.drawer.classList.contains('on')).toBe(true);
    expect(t.title.textContent).toBe('IOT-11');
    expect(t.panels.selectedIssueId()).toBe('i-11');
    expect(t.body.querySelector('[data-field="title"]').value).toBe('Conception');
    expect(t.body.querySelector('[data-field="state"]').value).toBe('st-iot-started');
    expect(t.body.querySelector('[data-field="state"]').selectedOptions[0].textContent).toBe('In Progress');
    expect(t.body.querySelector('[data-field="assignee"]').value).toBe('u-sacha');
    expect(t.body.querySelector('[data-field="estimate"]').value).toBe('8');
    expect(t.body.querySelector('[data-field="start"]').value).toBe('2026-09-16');
    expect(t.body.querySelector('[data-field="end"]').value).toBe('2026-09-25');
    // Texte fiable à côté du <input type="date"> natif, dont l'affichage
    // suit la locale du navigateur (souvent pas DD/MM/YYYY en anglais).
    expect(t.body.querySelector('[data-field="start"]').nextElementSibling.textContent).toBe('16/09/2026');
    expect(t.body.querySelector('[data-field="end"]').nextElementSibling.textContent).toBe('25/09/2026');
    const depsSelected = [...t.body.querySelector('[data-field="deps"]').selectedOptions].map((o) => o.value);
    expect(depsSelected).toEqual([]);
    const contribChecked = [...t.body.querySelectorAll('[data-field="contributors"] input:checked')].map((i) => i.value);
    expect(contribChecked).toEqual(['u-louis', 'u-sacha']);
    expect(t.body.querySelector('.soon')).toBeNull();
    const shareInputs = [...t.body.querySelectorAll('form[data-form="shares"] input')];
    expect(shareInputs.map((i) => [i.name, i.value])).toEqual([['u-sacha', '50'], ['u-louis', '50']]);
    expect(t.body.querySelector('[data-action="equal-shares"]')).toBeNull();
  });

  it('enregistre les parts saisies', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const [sacha, louis] = t.body.querySelectorAll('form[data-form="shares"] input');
    sacha.value = '70';
    louis.value = '30';
    submit(t.body.querySelector('form[data-form="shares"]'));
    await flush();
    expect(t.api.setContributions).toHaveBeenCalledWith('i-11', [
      { linearUserId: 'u-sacha', share: 70 },
      { linearUserId: 'u-louis', share: 30 },
    ]);
  });

  it('refuse des parts toutes nulles sans rien envoyer', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    for (const input of t.body.querySelectorAll('form[data-form="shares"] input')) input.value = '0';
    submit(t.body.querySelector('form[data-form="shares"]'));
    expect(t.onMutate).not.toHaveBeenCalled();
    const error = t.body.querySelector('[data-error]');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Les parts doivent être positives et leur somme non nulle.');
  });

  it('reprend une répartition ajustée et permet de revenir à l’égalité', async () => {
    const t = setup(context({ planningOver: { contributions: [{ issueId: 'i-11', linearUserId: 'u-sacha', share: 80 }] } }));
    t.panels.openIssue('i-11');
    // La part de Louis (dernier de la liste) se calcule pour compléter celle
    // de Sacha jusqu'à 100, pas juste sa valeur par défaut à parts égales.
    expect([...t.body.querySelectorAll('form[data-form="shares"] input')].map((i) => i.value)).toEqual(['80', '20']);
    t.body.querySelector('[data-action="equal-shares"]').click();
    await flush();
    expect(t.api.clearContributions).toHaveBeenCalledWith('i-11');
  });

  it('affiche la date DD/MM/AAAA en direct à côté du sélecteur natif', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const start = t.body.querySelector('[data-field="start"]');
    start.value = '2026-10-05';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    expect(start.nextElementSibling.textContent).toBe('05/10/2026');
  });

  it('recalcule en direct la dernière part pour que le total fasse toujours 100', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const [sacha, louis] = t.body.querySelectorAll('form[data-form="shares"] input');
    expect(louis.readOnly).toBe(true);
    sacha.value = '70';
    sacha.dispatchEvent(new Event('input', { bubbles: true }));
    expect(louis.value).toBe('30');
  });

  it('explique une tâche non planifiée et une tâche en conflit', () => {
    const t = setup(context({ mutate: (raw) => { raw.issues[1].description = 'Starting date: 24/09/2026'; } }));
    t.panels.openIssue('i-13');
    expect(t.body.textContent).toContain('Aucune ligne « Starting date » dans la description');
    expect(t.body.textContent).toContain('Ni ligne « Contributors » ni assigné');
    expect(t.body.querySelector('form')).toBeNull();
    t.panels.openIssue('i-12');
    expect(t.body.querySelector('.warn').textContent).toBe('Démarre avant la fin de IOT-11.');
    expect(t.body.textContent).toContain('l\'assigné porte toute la charge');
  });

  it('signale une issue disparue de l’instantané', () => {
    const t = setup();
    t.panels.openIssue('i-inconnue');
    expect(t.title.textContent).toBe('Tâche introuvable');
  });
});

describe('champs éditables', () => {
  it('modifie le titre au blur', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const input = t.body.querySelector('[data-field="title"]');
    input.value = 'Titre corrigé';
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { title: 'Titre corrigé' });
  });

  it('change l’assigné et l’estimation', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    change(t.body.querySelector('[data-field="assignee"]'), 'u-louis');
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { assigneeId: 'u-louis' });
    change(t.body.querySelector('[data-field="estimate"]'), '5');
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { estimate: 5 });
    change(t.body.querySelector('[data-field="state"]'), 'st-iot-completed');
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { stateId: 'st-iot-completed' });
  });

  it('modifie les contributeurs', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const container = t.body.querySelector('[data-field="contributors"]');
    const louisBox = [...container.querySelectorAll('input')].find((i) => i.value === 'u-louis');
    louisBox.checked = false;
    louisBox.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(t.api.setContributors).toHaveBeenCalledWith('i-11', ['u-sacha']);
  });

  it('replanifie début et fin en un seul appel', async () => {
    const t = setup();
    t.panels.openIssue('i-13');
    change(t.body.querySelector('[data-field="start"]'), '2026-10-01');
    change(t.body.querySelector('[data-field="end"]'), '2026-10-05');
    t.body.querySelector('[data-action="reschedule"]').click();
    await flush();
    expect(t.api.reschedule).toHaveBeenCalledWith('i-13', { start: '2026-10-01', end: '2026-10-05' });
  });

  it('modifie les dépendances', async () => {
    const t = setup();
    t.panels.openIssue('i-12');
    const select = t.body.querySelector('[data-field="deps"]');
    [...select.options].forEach((o) => { o.selected = o.value === 'i-20'; });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(t.api.setDependencies).toHaveBeenCalledWith('i-12', ['i-20']);
  });

  it('affiche la team et le projet de la tâche', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const rows = Object.fromEntries([...t.body.querySelectorAll('.ro')].map((r) => [r.children[0].textContent, r.children[1].textContent]));
    expect(rows.Team).toBe('IoT');
    expect(rows.Projet).toBe('Réalisation POC v1');
  });
});

describe('création', () => {
  it('ouvre un panneau de tâche vide avec team et projet préremplis', () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot', projectId: 'p-poc1' });
    expect(t.title.textContent).toBe('Nouvelle tâche');
    expect(t.body.querySelector('[data-field="title"]').value).toBe('');
  });

  it('crée la tâche et arme une annulation d’étiquette explicite', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot', projectId: 'p-poc1' });
    t.body.querySelector('[data-field="title"]').value = 'Nouvelle tâche';
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    expect(t.api.createIssue).toHaveBeenCalledWith({ teamId: 't-iot', projectId: 'p-poc1', title: 'Nouvelle tâche' });
    expect(t.onWrite).toHaveBeenCalled();
    expect(t.onWrite.mock.calls[0][1]).toMatch(/créée/);
  });

  it('ouvre un panneau de projet vide et le crée', async () => {
    const t = setup();
    t.panels.openProject(null);
    t.body.querySelector('[data-field="pname"]').value = 'Nouveau projet';
    t.body.querySelector('[data-action="create-project"]').click();
    await flush();
    expect(t.api.createProject).toHaveBeenCalledWith({ teamIds: [], name: 'Nouveau projet' });
  });
});

describe('panneau de personne', () => {
  it('enregistre rôle et capacité par défaut', async () => {
    const t = setup();
    t.panels.openPerson('u-louis');
    expect(t.title.textContent).toBe('Louis');
    const form = t.body.querySelector('form[data-form="person"]');
    form.querySelector('[name="role"]').value = '  hardware ';
    form.querySelector('[name="hours"]').value = '';
    submit(form);
    await flush();
    expect(t.api.updatePerson).toHaveBeenCalledWith('u-louis', { role: 'hardware', defaultWeeklyHours: null });
  });

  it('pose ou retire une capacité semaine par semaine', async () => {
    const t = setup();
    t.panels.openPerson('u-louis');
    const weeks = t.body.querySelectorAll('input[data-week]');
    expect(weeks).toHaveLength(4);
    change(weeks[0], '0');
    await flush();
    expect(t.api.setCapacity).toHaveBeenCalledWith('u-louis', '2026-09-14', 0);
    change(weeks[1], '');
    await flush();
    expect(t.api.clearCapacity).toHaveBeenCalledWith('u-louis', '2026-09-21');
  });

  it('signale une capacité hebdomadaire invalide sans rien envoyer', async () => {
    const t = setup();
    t.panels.openPerson('u-louis');
    const weeks = t.body.querySelectorAll('input[data-week]');
    change(weeks[0], '-3');
    await flush();
    expect(t.onMutate).not.toHaveBeenCalled();
    const error = t.body.querySelector('[data-capacity-error]');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('La capacité doit être un nombre positif.');
    change(weeks[0], '5');
    await flush();
    expect(t.api.setCapacity).toHaveBeenCalledWith('u-louis', '2026-09-14', 5);
    expect(error.hidden).toBe(true);
  });
});

describe('panneau des réglages', () => {
  it('enregistre les réglages et refuse les valeurs hors bornes', async () => {
    const t = setup();
    t.panels.openSettings();
    const form = t.body.querySelector('form[data-form="settings"]');
    form.querySelector('[name="loadCeilingPct"]').value = '5';
    submit(form);
    expect(t.onMutate).not.toHaveBeenCalled();
    form.querySelector('[name="hoursPerPoint"]').value = '4';
    form.querySelector('[name="loadCeilingPct"]').value = '85';
    form.querySelector('[name="defaultWeeklyHours"]').value = '30';
    submit(form);
    await flush();
    expect(t.api.updateSettings).toHaveBeenCalledWith({ hoursPerPoint: 4, loadCeilingPct: 85, defaultWeeklyHours: 30 });
  });

  it('ajoute et retire un jour chômé', async () => {
    const t = setup();
    t.panels.openSettings();
    const form = t.body.querySelector('form[data-form="holiday"]');
    form.querySelector('[name="day"]').value = '2026-12-24';
    form.querySelector('[name="label"]').value = 'Pont';
    submit(form);
    await flush();
    expect(t.api.addHoliday).toHaveBeenCalledWith('2026-12-24', 'Pont');
    t.body.querySelector('[data-action="delete-holiday"]').click();
    await flush();
    expect(t.api.deleteHoliday).toHaveBeenCalledWith('2026-11-11');
  });

  it('change la préférence d’affichage et oublie la clé', () => {
    const t = setup();
    t.panels.openSettings();
    const box = t.body.querySelector('input[data-pref="showCanceled"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(t.onPrefs).toHaveBeenCalledWith({ showCanceled: true });
    t.body.querySelector('[data-action="forget-key"]').click();
    expect(t.onForgetKey).toHaveBeenCalledOnce();
  });
});

describe('cycle de vie', () => {
  it('ferme le panneau', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.closeButton.click();
    expect(t.drawer.classList.contains('on')).toBe(false);
    expect(t.panels.selectedIssueId()).toBeNull();
  });

  it('ne redessine pas pendant une saisie', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const input = t.body.querySelector('input');
    input.focus();
    input.value = '12';
    t.panels.update(context());
    expect(t.body.querySelector('input')).toBe(input);
    expect(input.value).toBe('12');
    input.blur();
    t.panels.update(context());
    expect(t.body.querySelector('input')).not.toBe(input);
  });

  it('redessine tout de suite après une case à cocher (contributeurs)', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const checkbox = t.body.querySelector('[data-field="contributors"] input');
    checkbox.focus();
    const input = t.body.querySelector('input[data-field="title"]');
    t.panels.update(context());
    expect(t.body.querySelector('input[data-field="title"]')).not.toBe(input);
  });

  it('redessine après un clic sur un bouton du panneau', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('button[type="submit"]').focus();
    const input = t.body.querySelector('input');
    t.panels.update(context());
    expect(t.body.querySelector('input')).not.toBe(input);
  });
});
