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

function setup(ctx = context(), { lastError } = {}) {
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
    createMilestone: vi.fn(async () => ({})),
    deleteIssue: vi.fn(async () => ({})),
    deleteProject: vi.fn(async () => ({})),
    updateMilestone: vi.fn(async () => ({})),
  };
  const onMutate = vi.fn((call) => call(api));
  const onWrite = vi.fn((call) => call(api));
  const onPrefs = vi.fn();
  const onForgetKey = vi.fn();
  const panels = createPanels({ drawer, title, body, closeButton, onMutate, onPrefs, onForgetKey, onWrite, lastError });
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
    // Champ visible jj/mm/aaaa, indépendant de la locale du navigateur.
    expect(t.body.querySelector('#f-start').value).toBe('16/09/2026');
    expect(t.body.querySelector('#f-end').value).toBe('25/09/2026');
    const depsChecked = [...t.body.querySelectorAll('[data-field="deps"] input:checked')].map((i) => i.value);
    expect(depsChecked).toEqual([]);
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

  it('les flèches du champ de date suivent l\'ordre affiché jj/mm : jour, puis mois', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const text = t.body.querySelector('#f-start');
    const native = t.body.querySelector('[data-field="start"]');
    expect(native.value).toBe('2026-09-16');
    text.setSelectionRange(1, 1);
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(native.value).toBe('2026-09-17');
    text.setSelectionRange(4, 4);
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(native.value).toBe('2026-10-17');
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

  it('édite la description : le texte libre seul, sans les lignes Starting date / Contributors', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const area = t.body.querySelector('[data-field="description"]');
    expect(area.value).not.toMatch(/Starting date|Contributors/);
    area.value = 'Nouvelle description';
    area.dispatchEvent(new Event('blur'));
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { description: 'Nouvelle description' });
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

  it('enregistre une date dès qu\'elle change (replanification en cascade), sans bouton', async () => {
    const t = setup();
    t.panels.openIssue('i-13');
    expect(t.body.querySelector('[data-action="reschedule"]')).toBeNull();
    change(t.body.querySelector('[data-field="start"]'), '2026-10-01');
    await flush();
    expect(t.api.reschedule).not.toHaveBeenCalled(); // pas d'échéance encore : on attend
    change(t.body.querySelector('[data-field="end"]'), '2026-10-05');
    await flush();
    expect(t.api.reschedule).toHaveBeenCalledWith('i-13', { start: '2026-10-01', end: '2026-10-05' });
  });

  it('n\'enregistre pas une échéance avant le début, et le dit', async () => {
    const t = setup();
    t.panels.openIssue('i-13');
    change(t.body.querySelector('[data-field="start"]'), '2026-10-10');
    change(t.body.querySelector('[data-field="end"]'), '2026-10-05');
    await flush();
    expect(t.api.reschedule).not.toHaveBeenCalled();
    expect(t.body.querySelector('[data-date-error]').hidden).toBe(false);
  });

  it('modifie les dépendances', async () => {
    const t = setup();
    t.panels.openIssue('i-12');
    const box = [...t.body.querySelectorAll('[data-field="deps"] input')].find((i) => i.value === 'i-20');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    // i-12 dépend déjà de i-11 (fixture) : cocher i-20 en plus doit garder i-11.
    expect(t.api.setDependencies).toHaveBeenCalledWith('i-12', ['i-11', 'i-20']);
  });

  it('affiche la team et le projet de la tâche', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    expect(t.body.querySelector('[data-field="team"]').selectedOptions[0].textContent).toBe('IoT');
    expect(t.body.querySelector('[data-field="project"]').selectedOptions[0].textContent).toBe('Réalisation POC v1');
  });
});

describe('création', () => {
  it('ouvre un panneau de tâche vide avec team et projet préremplis', () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot', projectId: 'p-poc1' });
    expect(t.title.textContent).toBe('Nouvelle tâche');
    expect(t.body.querySelector('[data-field="title"]').value).toBe('');
  });

  it('crée la tâche avec ses dates, puis ferme le panneau', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot', projectId: 'p-poc1' });
    t.body.querySelector('[data-field="title"]').value = 'Nouvelle tâche';
    t.body.querySelector('[data-field="start"]').value = '2026-09-28';
    t.body.querySelector('[data-field="end"]').value = '2026-10-02';
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    expect(t.api.createIssue).toHaveBeenCalledWith({
      teamId: 't-iot', projectId: 'p-poc1', title: 'Nouvelle tâche', start: '2026-09-28', end: '2026-10-02',
    });
    expect(t.onWrite.mock.calls[0][1]).toMatch(/créée/);
    expect(t.drawer.classList.contains('on')).toBe(false);
  });

  it('propose tous les champs d\'une tâche à la création, comme le panneau d\'édition', () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot', projectId: 'p-poc1' });
    for (const name of ['title', 'project', 'state', 'assignee', 'estimate', 'start', 'end', 'deps', 'contributors']) {
      expect(t.body.querySelector(`[data-field="${name}"]`), name).not.toBeNull();
    }
    expect(t.body.querySelector('[data-field="project"]').value).toBe('p-poc1');
    const stateIds = [...t.body.querySelectorAll('[data-field="state"] option')].map((o) => o.value).filter(Boolean);
    expect(stateIds.length).toBeGreaterThan(0);
    expect(stateIds.every((id) => id.startsWith('st-iot'))).toBe(true);
  });

  it('envoie statut, responsable, estimation, dépendances et contributeurs choisis', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    const f = (n) => t.body.querySelector(`[data-field="${n}"]`);
    f('title').value = 'Complète';
    f('project').value = 'p-poc1';
    f('state').value = [...f('state').options].find((o) => o.value).value;
    f('assignee').value = 'u-louis';
    f('estimate').value = '5';
    f('deps').querySelector('input').checked = true;
    const blocker = f('deps').querySelector('input').value;
    f('contributors').querySelector('input[value="u-sacha"]').checked = true;
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    const arg = t.api.createIssue.mock.calls[0][0];
    expect(arg).toMatchObject({
      teamId: 't-iot', title: 'Complète', projectId: 'p-poc1', assigneeId: 'u-louis', estimate: 5,
      blockedBy: [blocker], contributorIds: ['u-sacha'],
    });
    expect(arg.stateId).toMatch(/^st-iot/);
  });

  it('crée une tâche sans dates si les deux champs sont vidés', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'Sans dates';
    t.body.querySelector('[data-field="start"]').value = '';
    t.body.querySelector('[data-field="end"]').value = '';
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    expect(t.api.createIssue).toHaveBeenCalledWith({ teamId: 't-iot', title: 'Sans dates' });
  });

  it('refuse une seule date ou une échéance avant le début', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'X';
    t.body.querySelector('[data-field="end"]').value = '';
    t.body.querySelector('[data-action="create-issue"]').click();
    expect(t.body.querySelector('[data-error]').hidden).toBe(false);
    t.body.querySelector('[data-field="start"]').value = '2026-10-02';
    t.body.querySelector('[data-field="end"]').value = '2026-09-28';
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    expect(t.body.querySelector('[data-error]').textContent).toMatch(/précède/);
    expect(t.api.createIssue).not.toHaveBeenCalled();
  });

  it('ne crée qu\'une tâche quand on clique plusieurs fois de suite', async () => {
    const t = setup();
    let release;
    t.onWrite.mockImplementation((call) => new Promise((resolve) => { release = () => resolve(call(t.api)); }));
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'Une seule';
    const button = t.body.querySelector('[data-action="create-issue"]');
    button.click();
    button.click();
    t.body.querySelector('[data-field="title"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(button.disabled).toBe(true);
    release();
    await flush();
    expect(t.onWrite).toHaveBeenCalledTimes(1);
    expect(t.api.createIssue).toHaveBeenCalledTimes(1);
  });

  it('garde le formulaire ouvert, saisie intacte, si la création échoue', async () => {
    const t = setup();
    t.onWrite.mockImplementation(async () => false);
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'Échec';
    const button = t.body.querySelector('[data-action="create-issue"]');
    button.click();
    await flush();
    expect(t.drawer.classList.contains('on')).toBe(true);
    expect(t.body.querySelector('[data-field="title"]').value).toBe('Échec');
    expect(button.disabled).toBe(false);
  });

  it('ne vide pas le formulaire de création quand le contexte est rafraîchi', () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'En cours de saisie';
    t.panels.update(context());
    expect(t.body.querySelector('[data-field="title"]').value).toBe('En cours de saisie');
  });

  it('permet de modifier les dates et la couleur d’un projet existant', async () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    change(t.body.querySelector('[data-field="pstart"]'), '2026-09-20');
    await flush();
    expect(t.api.updateProject).toHaveBeenCalledWith('p-poc1', { startDate: '2026-09-20' });
    change(t.body.querySelector('[data-field="ptarget"]'), '2026-11-20');
    await flush();
    expect(t.api.updateProject).toHaveBeenCalledWith('p-poc1', { targetDate: '2026-11-20' });
    change(t.body.querySelector('[data-field="pcolor"]'), '#ff0000');
    await flush();
    expect(t.api.updateProject).toHaveBeenCalledWith('p-poc1', { color: '#ff0000' });
  });

  it('ouvre un panneau de projet vide, préchoisit la team demandée et le crée', async () => {
    const t = setup();
    t.panels.openProject(null, { teamId: 't-web' });
    const boxes = [...t.body.querySelectorAll('[data-field="pteams"] input')];
    expect(boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(['t-web']);
    t.body.querySelector('[data-field="pname"]').value = 'Nouveau projet';
    t.body.querySelector('[data-action="create-project"]').click();
    await flush();
    expect(t.api.createProject).toHaveBeenCalledWith({ teamIds: ['t-web'], name: 'Nouveau projet' });
  });

  it('crée un projet avec plusieurs teams, dates et couleur choisies', async () => {
    const t = setup();
    t.panels.openProject(null, { teamId: 't-web' });
    for (const b of t.body.querySelectorAll('[data-field="pteams"] input')) b.checked = true;
    t.body.querySelector('[data-field="pname"]').value = 'Grand projet';
    t.body.querySelector('[data-field="pstart"]').value = '2026-10-01';
    t.body.querySelector('[data-field="ptarget"]').value = '2026-12-01';
    const color = t.body.querySelector('[data-field="pcolor"]');
    color.value = '#ff0000';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    t.body.querySelector('[data-action="create-project"]').click();
    await flush();
    const arg = t.api.createProject.mock.calls[0][0];
    expect(arg.teamIds.length).toBeGreaterThan(1);
    expect(arg).toMatchObject({ name: 'Grand projet', startDate: '2026-10-01', targetDate: '2026-12-01', color: '#ff0000' });
  });

  it('refuse un projet sans team ou dont l\'échéance précède le début', async () => {
    const t = setup();
    t.panels.openProject(null, { teamId: 't-web' });
    t.body.querySelector('[data-field="pname"]').value = 'P';
    for (const b of t.body.querySelectorAll('[data-field="pteams"] input')) b.checked = false;
    t.body.querySelector('[data-action="create-project"]').click();
    expect(t.body.querySelector('[data-error]').textContent).toMatch(/team/);
    t.body.querySelector('[data-field="pteams"] input').checked = true;
    t.body.querySelector('[data-field="pstart"]').value = '2026-12-01';
    t.body.querySelector('[data-field="ptarget"]').value = '2026-10-01';
    t.body.querySelector('[data-action="create-project"]').click();
    expect(t.body.querySelector('[data-error]').textContent).toMatch(/précède/);
    expect(t.api.createProject).not.toHaveBeenCalled();
  });

  it('ouvre un panneau de team vide et la crée, clé en majuscules', async () => {
    const t = setup();
    t.panels.openTeam();
    t.body.querySelector('[data-field="tkey"]').value = 'new';
    t.body.querySelector('[data-field="tname"]').value = 'Nouvelle team';
    t.body.querySelector('[data-action="create-team"]').click();
    await flush();
    expect(t.api.createTeam).toHaveBeenCalledWith({ key: 'NEW', name: 'Nouvelle team' });
  });

  it('refuse de créer une team sans clé ou sans nom', () => {
    const t = setup();
    t.panels.openTeam();
    t.body.querySelector('[data-action="create-team"]').click();
    expect(t.api.createTeam).not.toHaveBeenCalled();
    expect(t.body.querySelector('[data-error]').hidden).toBe(false);
  });

  it('ouvre un panneau de jalon et modifie sa date', async () => {
    const t = setup();
    t.panels.openMilestone('m-1');
    expect(t.title.textContent).toBe('Objet construit');
    expect(t.body.querySelector('[data-field="mdate"]').value).toBe('2026-11-05');
    change(t.body.querySelector('[data-field="mdate"]'), '2026-11-12');
    await flush();
    expect(t.api.updateMilestone).toHaveBeenCalledWith('m-1', '2026-11-12');
  });

  it('signale un jalon disparu', () => {
    const t = setup();
    t.panels.openMilestone('m-inconnu');
    expect(t.body.textContent).toContain('ne figure plus');
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

describe('suppression', () => {
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('ne supprime rien au premier clic : il ouvre seulement l\'écran de confirmation', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    await flush();
    expect(t.title.textContent).toBe('Supprimer IOT-11 ?');
    expect(t.api.deleteIssue).not.toHaveBeenCalled();
    expect(t.onWrite).not.toHaveBeenCalled();
    expect(t.body.querySelector('[data-action="confirm-delete"]').disabled).toBe(true);
  });

  it('garde le bouton inactif tant que l\'identifiant exact n\'est pas saisi', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    const input = t.body.querySelector('[data-field="confirm"]');
    const confirm = t.body.querySelector('[data-action="confirm-delete"]');
    for (const wrong of ['', 'iot-11', 'IOT-1', 'IOT-111', 'Conception']) {
      type(input, wrong);
      expect(confirm.disabled).toBe(true);
    }
    type(input, 'IOT-11');
    expect(confirm.disabled).toBe(false);
  });

  it('ignore le clic même si le bouton est réactivé à la main sans la bonne saisie', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    const confirm = t.body.querySelector('[data-action="confirm-delete"]');
    confirm.disabled = false;
    confirm.click();
    await flush();
    expect(t.api.deleteIssue).not.toHaveBeenCalled();
  });

  it('n\'est pas validé par Entrée', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    const input = t.body.querySelector('[data-field="confirm"]');
    type(input, 'IOT-11');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    await flush();
    expect(enter.defaultPrevented).toBe(true);
    expect(t.api.deleteIssue).not.toHaveBeenCalled();
  });

  it('supprime la tâche une seule fois malgré des clics répétés, puis ferme le panneau', async () => {
    const t = setup();
    let release;
    t.onWrite.mockImplementation((call) => new Promise((resolve) => { release = () => resolve(call(t.api)); }));
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    type(t.body.querySelector('[data-field="confirm"]'), 'IOT-11');
    const confirm = t.body.querySelector('[data-action="confirm-delete"]');
    confirm.click();
    confirm.click();
    confirm.click();
    release();
    await flush();
    expect(t.onWrite).toHaveBeenCalledTimes(1);
    expect(t.api.deleteIssue).toHaveBeenCalledExactlyOnceWith('i-11', 'IOT-11');
    expect(t.drawer.classList.contains('on')).toBe(false);
  });

  it('annuler revient à la tâche sans rien supprimer', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    t.body.querySelector('[data-action="cancel-delete"]').click();
    expect(t.title.textContent).toBe('IOT-11');
    expect(t.body.querySelector('[data-field="title"]')).not.toBeNull();
    expect(t.api.deleteIssue).not.toHaveBeenCalled();
  });

  it('garde l\'écran ouvert si la suppression échoue', async () => {
    const t = setup();
    t.onWrite.mockImplementation(async () => false);
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    type(t.body.querySelector('[data-field="confirm"]'), 'IOT-11');
    t.body.querySelector('[data-action="confirm-delete"]').click();
    await flush();
    expect(t.drawer.classList.contains('on')).toBe(true);
    expect(t.body.querySelector('[data-field="confirm"]').value).toBe('IOT-11');
  });

  it('affiche dans l\'écran de confirmation la raison du refus de Linear', async () => {
    const t = setup(context(), { lastError: () => 'Erreur GraphQL Linear : Forbidden' });
    t.onWrite.mockImplementation(async () => false);
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="ask-delete"]').click();
    const name = t.title.textContent.replace(/^Supprimer le projet | \?$/g, '');
    type(t.body.querySelector('[data-field="confirm"]'), name);
    t.body.querySelector('[data-action="confirm-delete"]').click();
    await flush();
    const slot = t.body.querySelector('[data-error]');
    expect(slot.hidden).toBe(false);
    expect(slot.textContent).toBe('Erreur GraphQL Linear : Forbidden');
    expect(t.drawer.classList.contains('on')).toBe(true);
  });

  it('ne vide pas la saisie de confirmation quand le contexte est rafraîchi', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    t.body.querySelector('[data-action="ask-delete"]').click();
    type(t.body.querySelector('[data-field="confirm"]'), 'IOT');
    t.panels.update(context());
    expect(t.body.querySelector('[data-field="confirm"]').value).toBe('IOT');
  });

  it('supprime un projet en exigeant son nom exact, et annonce que ses tâches restent', async () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="ask-delete"]').click();
    expect(t.body.textContent).toMatch(/ne sont pas supprimées|n'est pas supprimée/);
    const name = t.title.textContent.replace(/^Supprimer le projet | \?$/g, '');
    const input = t.body.querySelector('[data-field="confirm"]');
    const confirm = t.body.querySelector('[data-action="confirm-delete"]');
    type(input, name.toLowerCase());
    expect(confirm.disabled).toBe(true);
    type(input, name);
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await flush();
    expect(t.api.deleteProject).toHaveBeenCalledWith('p-poc1', name);
  });
});

describe('sélecteur de tâches bloquantes', () => {
  const visibleIds = (t) => [...t.body.querySelectorAll('[data-field="deps"] .chkrow:not([hidden]) input')].map((i) => i.value);
  const allIds = (t) => [...t.body.querySelectorAll('[data-field="deps"] .chkrow input')].map((i) => i.value);
  const setControl = (t, name, value) => {
    const el = t.body.querySelector(`[data-pk="${name}"]`);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(el.type === 'search' ? 'input' : 'change', { bubbles: true }));
  };

  it('propose recherche et filtres au-dessus de la liste, dans l\'édition comme à la création', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    for (const n of ['q', 'team', 'project', 'status', 'only']) expect(t.body.querySelector(`[data-pk="${n}"]`), n).not.toBeNull();
    t.panels.openIssue(null, { teamId: 't-iot' });
    for (const n of ['q', 'team', 'project', 'status', 'only']) expect(t.body.querySelector(`[data-pk="${n}"]`), n).not.toBeNull();
  });

  it('cherche par identifiant ou titre, sans tenir compte de la casse ni des accents', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const all = allIds(t);
    expect(all).not.toContain('i-11');
    const first = t.body.querySelector('[data-field="deps"] .chkrow');
    const identifier = first.dataset.text.split(' ')[0];
    setControl(t, 'q', identifier.toLowerCase());
    expect(visibleIds(t)).toEqual([first.querySelector('input').value]);
    setControl(t, 'q', 'zzzz-inexistant');
    expect(visibleIds(t)).toEqual([]);
    expect(t.body.querySelector('[data-pk-empty]').hidden).toBe(false);
    setControl(t, 'q', '');
    expect(visibleIds(t)).toEqual(all);
  });

  it('filtre par team, projet et statut', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const rows = [...t.body.querySelectorAll('[data-field="deps"] .chkrow')];
    const team = rows[0].dataset.team;
    setControl(t, 'team', team);
    expect(visibleIds(t)).toEqual(rows.filter((r) => r.dataset.team === team).map((r) => r.querySelector('input').value));
    setControl(t, 'team', '');
    const status = rows[0].dataset.status;
    expect(status).toMatch(/^(Todo|In Progress|Done|Canceled)$/);
    setControl(t, 'status', status);
    expect(visibleIds(t)).toEqual(rows.filter((r) => r.dataset.status === status).map((r) => r.querySelector('input').value));
    setControl(t, 'status', '');
    setControl(t, 'project', 'none');
    expect(visibleIds(t)).toEqual(rows.filter((r) => r.dataset.project === 'none').map((r) => r.querySelector('input').value));
  });

  it('le filtre de statut propose les vrais statuts Linear, sans doublon, dans l\'ordre du cycle de vie', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const names = [...t.body.querySelectorAll('[data-pk="status"] option')].map((o) => o.textContent);
    expect(names).toEqual(['Tous les statuts', 'Todo', 'In Progress', 'Done', 'Canceled']);
  });

  it('« cochées seulement » ne montre que la sélection', () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    const boxes = [...t.body.querySelectorAll('[data-field="deps"] input')];
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    setControl(t, 'only', true);
    expect(visibleIds(t)).toEqual([boxes[1].value]);
  });

  it('une tâche cochée puis masquée par un filtre reste bien envoyée', async () => {
    const t = setup();
    t.panels.openIssue(null, { teamId: 't-iot' });
    t.body.querySelector('[data-field="title"]').value = 'X';
    const box = t.body.querySelector('[data-field="deps"] input');
    box.checked = true;
    setControl(t, 'q', 'zzzz-inexistant');
    expect(visibleIds(t)).toEqual([]);
    t.body.querySelector('[data-action="create-issue"]').click();
    await flush();
    expect(t.api.createIssue.mock.calls[0][0].blockedBy).toEqual([box.value]);
  });

  it('garde recherche et filtres quand le panneau est redessiné, et les remet à zéro pour une autre tâche', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    setControl(t, 'q', 'zzzz');
    t.panels.update(context());
    expect(t.body.querySelector('[data-pk="q"]').value).toBe('zzzz');
    t.panels.openIssue('i-12');
    expect(t.body.querySelector('[data-pk="q"]').value).toBe('');
  });

  it('le compteur indique affichées, total et cochées', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const total = allIds(t).length;
    expect(t.body.querySelector('[data-pk-count]').textContent).toMatch(new RegExp(`${total} affichées? sur ${total} · \\d+ cochées?`));
  });
});

describe('déplacer une tâche', () => {
  it('propose team et projet modifiables, avec un bouton Déplacer inactif tant que la team ne change pas', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const select = t.body.querySelector('[data-field="team"]');
    const button = t.body.querySelector('[data-action="move-team"]');
    expect(select.value).toBe('t-iot');
    expect(button.disabled).toBe(true);
    expect(t.body.querySelector('[data-field="project"]').value).toBe('p-poc1');
  });

  it('ne déplace pas au simple choix d\'une team : il faut cliquer sur Déplacer', async () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const select = t.body.querySelector('[data-field="team"]');
    select.value = 't-web';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(t.api.updateIssue).not.toHaveBeenCalled();
    const button = t.body.querySelector('[data-action="move-team"]');
    expect(button.disabled).toBe(false);
    expect(t.body.querySelector('[data-move-hint]').hidden).toBe(false);
    button.click();
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { teamId: 't-web' });
    expect(t.onWrite.mock.calls.at(-1)[1]).toMatch(/IOT-11 déplacée vers/);
  });

  it('arme une annulation qui remet team, statut et projet d\'origine', async () => {
    const t = setup();
    t.onWrite.mockImplementation((call, label, restore) => { t.restore = restore; return call(t.api); });
    t.panels.openIssue('i-11');
    const select = t.body.querySelector('[data-field="team"]');
    select.value = 't-web';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    t.body.querySelector('[data-action="move-team"]').click();
    await flush();
    await t.restore(t.api);
    expect(t.api.updateIssue).toHaveBeenLastCalledWith('i-11', { teamId: 't-iot', stateId: 'st-iot-started', projectId: 'p-poc1' });
  });

  it('change le projet d\'une tâche, limité aux projets de sa team', async () => {
    const t = setup();
    t.panels.openIssue('i-20');
    const options = [...t.body.querySelectorAll('[data-field="project"] option')].map((o) => o.value);
    expect(options).toEqual(['']);
    t.panels.openIssue('i-11');
    const project = t.body.querySelector('[data-field="project"]');
    project.value = '';
    project.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(t.api.updateIssue).toHaveBeenCalledWith('i-11', { projectId: null });
  });
});

describe('défilement conservé au redessin', () => {
  // Un navigateur ramène le défilement en haut quand le contenu est remplacé ;
  // jsdom ne le fait pas, on le simule pour que le test ait un sens.
  function resetOnRewrite(body) {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(body, 'innerHTML', {
      get() { return desc.get.call(this); },
      set(value) { desc.set.call(this, value); this.scrollTop = 0; },
    });
  }

  it('garde la position du panneau et de la liste des contributeurs quand on coche quelqu\'un', () => {
    const t = setup();
    resetOnRewrite(t.body);
    t.panels.openIssue('i-11');
    t.body.scrollTop = 320;
    t.body.querySelector('[data-field="contributors"]').scrollTop = 45;
    t.body.querySelector('[data-field="deps"]').scrollTop = 30;
    t.panels.update(context());
    expect(t.body.scrollTop).toBe(320);
    expect(t.body.querySelector('[data-field="contributors"]').scrollTop).toBe(45);
    expect(t.body.querySelector('[data-field="deps"]').scrollTop).toBe(30);
  });

  it('redonne le focus à la case cochée, sans faire défiler', () => {
    const t = setup();
    t.panels.openIssue('i-11');
    const box = t.body.querySelector('[data-field="contributors"] input[value="u-louis"]');
    box.focus();
    expect(document.activeElement).toBe(box);
    t.panels.update(context());
    const again = t.body.querySelector('[data-field="contributors"] input[value="u-louis"]');
    expect(again).not.toBe(box);
    expect(document.activeElement).toBe(again);
  });

  it('repart du haut quand on ouvre une autre tâche', () => {
    const t = setup();
    resetOnRewrite(t.body);
    t.panels.openIssue('i-11');
    t.body.scrollTop = 320;
    t.body.querySelector('[data-field="contributors"]').scrollTop = 45;
    t.panels.openIssue('i-12');
    expect(t.body.scrollTop).toBe(0);
    expect(t.body.querySelector('[data-field="contributors"]').scrollTop).toBe(0);
  });
});

describe('ajouter un jalon', () => {
  it('le panneau de projet liste les jalons et propose d\'en ajouter', () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    expect(t.body.textContent).toContain('Objet construit');
    expect(t.body.querySelector('[data-action="add-milestone"]')).not.toBeNull();
  });

  it('propose l\'ajout même quand le projet n\'a encore aucun jalon', () => {
    const t = setup(context({ mutate: (raw) => { raw.projects[0].projectMilestones = { nodes: [] }; } }));
    t.panels.openProject('p-poc1');
    expect(t.body.textContent).toContain('Aucun jalon');
    expect(t.body.querySelector('[data-action="add-milestone"]')).not.toBeNull();
  });

  it('ouvre le formulaire de jalon avec le projet, et la date d\'échéance du projet proposée', () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="add-milestone"]').click();
    expect(t.title.textContent).toBe('Nouveau jalon');
    expect(t.body.textContent).toContain('Réalisation POC v1');
    expect(t.body.querySelector('[data-field="mdate"]').value).toBe('2026-11-05');
  });

  it('crée le jalon (nom, date, projet), puis ferme le panneau', async () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="add-milestone"]').click();
    t.body.querySelector('[data-field="mname"]').value = '  Livraison ';
    t.body.querySelector('[data-field="mdate"]').value = '2026-12-01';
    t.body.querySelector('[data-action="create-milestone"]').click();
    await flush();
    expect(t.api.createMilestone).toHaveBeenCalledWith({ projectId: 'p-poc1', name: 'Livraison', targetDate: '2026-12-01' });
    expect(t.onWrite.mock.calls.at(-1)[1]).toMatch(/Jalon « Livraison » créé/);
    expect(t.drawer.classList.contains('on')).toBe(false);
  });

  it('crée un jalon sans date si le champ est vidé', async () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="add-milestone"]').click();
    t.body.querySelector('[data-field="mname"]').value = 'À dater';
    t.body.querySelector('[data-field="mdate"]').value = '';
    t.body.querySelector('[data-action="create-milestone"]').click();
    await flush();
    expect(t.api.createMilestone).toHaveBeenCalledWith({ projectId: 'p-poc1', name: 'À dater' });
  });

  it('refuse un nom vide, et ne crée qu\'un jalon malgré des clics répétés', async () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="add-milestone"]').click();
    const button = t.body.querySelector('[data-action="create-milestone"]');
    button.click();
    expect(t.body.querySelector('[data-error]').textContent).toMatch(/nom/);
    expect(t.api.createMilestone).not.toHaveBeenCalled();
    let release;
    t.onWrite.mockImplementation((call) => new Promise((resolve) => { release = () => resolve(call(t.api)); }));
    t.body.querySelector('[data-field="mname"]').value = 'Une fois';
    button.click(); button.click(); button.click();
    release();
    await flush();
    expect(t.api.createMilestone).toHaveBeenCalledTimes(1);
  });

  it('ne vide pas la saisie quand le contexte est rafraîchi', () => {
    const t = setup();
    t.panels.openProject('p-poc1');
    t.body.querySelector('[data-action="add-milestone"]').click();
    t.body.querySelector('[data-field="mname"]').value = 'En cours de frappe';
    t.panels.update(context());
    expect(t.body.querySelector('[data-field="mname"]').value).toBe('En cours de frappe');
  });

  it('modifier la date d\'un jalon existant, en tapant jj/mm/aaaa, l\'envoie en ISO avec annulation possible', async () => {
    const t = setup();
    t.panels.openMilestone('m-1');
    const text = t.body.querySelector('#f-mdate');
    expect(text.value).toBe('05/11/2026');
    text.value = '12112026';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(t.api.updateMilestone).toHaveBeenCalledWith('m-1', '2026-11-12');
    expect(typeof t.onWrite.mock.calls.at(-1)[2]).toBe('function');
  });
});
