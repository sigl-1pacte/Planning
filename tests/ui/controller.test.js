import { describe, it, expect, vi } from 'vitest';
import { createController, POLL_MS, OVERLAY_MS } from '../../src/ui/controller.js';
import { AuthError, ApiError } from '../../src/ui/api.js';

const snap = (version, domain = { issues: [] }) => ({ version, fetchedAt: 'x', stale: false, lastError: null, domain });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(api) {
  const render = vi.fn();
  const showKeyScreen = vi.fn();
  let tick = null;
  const setIntervalImpl = vi.fn((fn, ms) => { tick = fn; return 7; });
  const clearIntervalImpl = vi.fn();
  const c = createController({ api, render, showKeyScreen, setIntervalImpl, clearIntervalImpl });
  return { c, render, showKeyScreen, setIntervalImpl, clearIntervalImpl, tick: () => tick() };
}

describe('controller', () => {
  it('demande la clé quand aucune n’est enregistrée', async () => {
    const t = setup({ getKey: () => null });
    await t.c.start();
    expect(t.showKeyScreen).toHaveBeenCalledWith(null);
    expect(t.render).not.toHaveBeenCalled();
  });

  it('charge instantané et planification puis interroge toutes les 30 secondes', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce({ ...snap(1), domain: null }),
      planning: vi.fn(async () => ({ settings: {} })),
    };
    const t = setup(api);
    await t.c.start();
    expect(t.setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), POLL_MS);
    expect(t.c.state.snapshot.version).toBe(1);
    await t.tick();
    expect(api.snapshot).toHaveBeenLastCalledWith(1);
    expect(t.c.state.snapshot.domain).toEqual({ issues: [] });
    expect(t.render).toHaveBeenCalledTimes(2);
  });

  it('remplace le domaine quand la version change', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2, { issues: [{ id: 'i1' }] })),
      planning: vi.fn(async () => ({})),
    };
    const t = setup(api);
    await t.c.start();
    await t.tick();
    expect(t.c.state.snapshot.domain.issues).toEqual([{ id: 'i1' }]);
  });

  it('affiche l’écran de clé par-dessus la vue et arrête l’interrogation sur 401', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockResolvedValueOnce(snap(1)).mockRejectedValueOnce(new AuthError('Clé Linear invalide ou révoquée')),
      planning: vi.fn(async () => ({})),
    };
    const t = setup(api);
    await t.c.start();
    await t.tick();
    expect(t.showKeyScreen).toHaveBeenCalledWith('Clé Linear invalide ou révoquée');
    expect(t.clearIntervalImpl).toHaveBeenCalledWith(7);
    expect(t.c.state.snapshot.version).toBe(1);
  });

  it('garde la vue et note l’erreur si le serveur échoue', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockResolvedValueOnce(snap(1)).mockRejectedValueOnce(new ApiError('Linear injoignable', 503)),
      planning: vi.fn(async () => ({})),
    };
    const t = setup(api);
    await t.c.start();
    await t.tick();
    expect(t.c.state.error).toBe('Linear injoignable');
    expect(t.c.state.snapshot.version).toBe(1);
  });

  it('applique une modification en remplaçant la planification', async () => {
    const api = { getKey: () => 'k', snapshot: vi.fn(async () => snap(1)), planning: vi.fn(async () => ({ v: 1 })) };
    const t = setup(api);
    await t.c.start();
    await t.c.mutate(async () => ({ v: 2 }));
    expect(t.c.state.planning).toEqual({ v: 2 });
  });

  it('affiche l’erreur et réessaie quand le premier chargement échoue', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockRejectedValueOnce(new ApiError('Linear injoignable', 503)).mockResolvedValue(snap(1)),
      planning: vi.fn(async () => ({ v: 1 })),
    };
    const t = setup(api);
    await t.c.start();
    expect(t.render).toHaveBeenCalledWith(expect.objectContaining({ error: 'Linear injoignable', snapshot: null }));
    expect(t.setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), POLL_MS);
    await t.tick();
    expect(t.c.state.snapshot.version).toBe(1);
    expect(t.c.state.error).toBeNull();
    expect(t.setIntervalImpl).toHaveBeenCalledTimes(2);
    expect(t.setIntervalImpl).toHaveBeenLastCalledWith(t.c.poll, POLL_MS);
  });

  it('remplace la planification à chaque interrogation', async () => {
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn(async () => snap(1)),
      planning: vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 }),
    };
    const t = setup(api);
    await t.c.start();
    await t.tick();
    expect(t.c.state.planning).toEqual({ v: 2 });
  });

  it('ne laisse pas une interrogation écraser une modification commencée entre-temps', async () => {
    const late = deferred();
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn(async () => snap(1)),
      planning: vi.fn().mockResolvedValueOnce({ v: 1 }).mockReturnValueOnce(late.promise),
    };
    const t = setup(api);
    await t.c.start();
    const polling = t.tick();
    await t.c.mutate(async () => ({ v: 'mutée' }));
    late.resolve({ v: 'ancienne' });
    await polling;
    expect(t.c.state.planning).toEqual({ v: 'mutée' });
  });

  it('ne laisse pas une interrogation antérieure à l\'écriture effacer ce qu\'elle vient de créer', async () => {
    const late = deferred();
    const before = { issues: [] };
    const after = { issues: [{ id: 'i-new' }] };
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn().mockResolvedValueOnce(snap(1, before)).mockReturnValueOnce(late.promise),
      planning: vi.fn(async () => ({ v: 1 })),
      resync: vi.fn(async () => snap(2, after)),
    };
    const t = setup(api);
    await t.c.start();
    const polling = t.tick();
    // Une création (sans aperçu) se termine une fois relue depuis Linear.
    await t.c.mutate(async () => ({ sync: { reflected: (d) => d.issues.some((i) => i.id === 'i-new'), full: false } }));
    expect(t.c.state.snapshot.domain).toEqual(after);
    late.resolve(snap(1, before));
    await polling;
    expect(t.c.state.snapshot.domain).toEqual(after);
  });

  it('exécute les modifications l\'une après l\'autre, dans l\'ordre', async () => {
    const api = { getKey: () => 'k', snapshot: vi.fn(async () => snap(1)), planning: vi.fn(async () => ({ v: 0 })) };
    const t = setup(api);
    await t.c.start();
    t.render.mockClear();
    const first = deferred();
    const secondCall = vi.fn(async () => ({ v: 2 }));
    const m1 = t.c.mutate(() => first.promise);
    const m2 = t.c.mutate(secondCall);
    expect(t.c.queuedWrites()).toBe(2);
    await Promise.resolve();
    expect(secondCall).not.toHaveBeenCalled();
    first.resolve({ v: 1 });
    await Promise.all([m1, m2]);
    expect(secondCall).toHaveBeenCalledTimes(1);
    expect(t.c.state.planning).toEqual({ v: 2 });
    // Seule la dernière de la file redessine.
    expect(t.render).toHaveBeenCalledTimes(1);
    expect(t.c.queuedWrites()).toBe(0);
  });

  it('poursuit la file après un échec et garde son erreur affichée', async () => {
    const api = { getKey: () => 'k', snapshot: vi.fn(async () => snap(1)), planning: vi.fn(async () => ({ v: 0 })) };
    const t = setup(api);
    await t.c.start();
    const m1 = t.c.mutate(async () => { throw new ApiError('Linear injoignable', 503); });
    const m2 = t.c.mutate(async () => ({ v: 2 }));
    expect(await m1).toBe(false);
    expect(await m2).toEqual({ v: 2 });
    expect(t.c.state.planning).toEqual({ v: 2 });
    expect(t.c.state.error).toBe('Linear injoignable');
    await t.c.mutate(async () => ({ v: 3 }));
    expect(t.c.state.error).toBeNull();
  });

  it('force un rafraîchissement', async () => {
    const api = {
      getKey: () => 'k', snapshot: vi.fn(async () => snap(1)), planning: vi.fn(async () => ({})),
      refresh: vi.fn(async () => snap(5)),
    };
    const t = setup(api);
    await t.c.start();
    await t.c.refresh();
    expect(t.c.state.snapshot.version).toBe(5);
  });
});

describe('controller — écritures Linear en file, affichées tout de suite', () => {
  const issues = (...titles) => ({ issues: titles.map((title, n) => ({ id: `i${n}`, title })) });
  const retitle = (id, title) => (d) => ({ ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, title } : i)) });
  const linearWrite = (sync = { full: false }) => async () => ({ sync });
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  };

  function linearSetup(server = issues('A', 'B')) {
    const linear = { domain: server };
    const api = {
      getKey: () => 'k',
      snapshot: vi.fn(async () => snap(1, linear.domain)),
      planning: vi.fn(async () => ({ v: 1 })),
      resync: vi.fn(async () => snap(2, linear.domain)),
    };
    let clock = 0;
    const render = vi.fn();
    let tick = null;
    const c = createController({
      api, render, showKeyScreen: vi.fn(), setIntervalImpl: (fn) => { tick = fn; return 1; }, clearIntervalImpl: () => {},
      now: () => clock, resyncDelayMs: 0,
    });
    // Linear « écrit » : ses relectures suivantes montreront la modification.
    const writeInLinear = (id, title) => { linear.domain = retitle(id, title)(linear.domain); };
    return { c, render, api, tick: () => tick(), writeInLinear, advance: (ms) => { clock += ms; } };
  }

  const titles = (t) => t.c.state.snapshot.domain.issues.map((i) => i.title);

  it('affiche la modification avant même que Linear réponde', async () => {
    const t = linearSetup();
    await t.c.start();
    t.render.mockClear();
    const linearCall = deferred();
    const done = t.c.mutate(() => linearCall.promise, { preview: retitle('i0', 'A2') });
    expect(titles(t)).toEqual(['A2', 'B']);
    expect(t.render).toHaveBeenCalledTimes(1);
    t.writeInLinear('i0', 'A2');
    linearCall.resolve({ sync: { full: false } });
    await done;
    await flush();
    expect(titles(t)).toEqual(['A2', 'B']);
  });

  it('relit Linear une seule fois, quand la file est vide, et en incrémental', async () => {
    const t = linearSetup();
    await t.c.start();
    const writes = ['A2', 'A3', 'A4'].map((title) => t.c.mutate(async () => {
      t.writeInLinear('i0', title);
      return { sync: { full: false } };
    }, { preview: retitle('i0', title) }));
    await Promise.all(writes);
    await flush();
    // Les écritures remplacées (A2, A3) ne font pas relire en boucle.
    expect(t.api.resync).toHaveBeenCalledTimes(1);
    expect(t.api.resync).toHaveBeenCalledWith({ full: false });
    expect(titles(t)).toEqual(['A4', 'B']);
    expect(t.c.writeDomain().issues[0].title).toBe('A4');
  });

  it('une création attend d\'être relue, en réessayant si Linear ne la montre pas encore', async () => {
    const t = linearSetup();
    await t.c.start();
    t.api.resync
      .mockResolvedValueOnce(snap(2, issues('A', 'B')))
      .mockResolvedValueOnce(snap(3, issues('A', 'B', 'Nouvelle')));
    const reflected = (d) => d.issues.some((i) => i.title === 'Nouvelle');
    await t.c.mutate(async () => ({ sync: { full: false, reflected } }));
    expect(t.api.resync).toHaveBeenCalledTimes(2);
    expect(titles(t)).toEqual(['A', 'B', 'Nouvelle']);
  });

  it('relit en entier si une des écritures le demande', async () => {
    const t = linearSetup();
    await t.c.start();
    t.c.mutate(linearWrite({ full: false }), { preview: retitle('i0', 'x') });
    await t.c.mutate(linearWrite({ full: true }), { preview: retitle('i1', 'y') });
    await flush();
    expect(t.api.resync).toHaveBeenCalledWith({ full: true });
  });

  it('chaque écriture calcule ce qu\'elle envoie depuis les précédentes faites, pas depuis celles en attente', async () => {
    const t = linearSetup();
    await t.c.start();
    const seen = [];
    const first = deferred();
    t.c.mutate(async () => { seen.push(t.c.writeDomain().issues[0].title); await first.promise; return { sync: {} }; }, { preview: retitle('i0', 'A2') });
    const second = t.c.mutate(async () => { seen.push(t.c.writeDomain().issues[0].title); return { sync: {} }; }, { preview: retitle('i0', 'A3') });
    await flush();
    first.resolve();
    await second;
    expect(seen).toEqual(['A', 'A2']);
  });

  it('retire l\'aperçu d\'une écriture refusée et affiche l\'erreur, sans toucher aux autres', async () => {
    const t = linearSetup();
    await t.c.start();
    const bad = t.c.mutate(async () => { throw new ApiError('Refusé', 422); }, { preview: retitle('i0', 'A2') });
    t.c.mutate(linearWrite(), { preview: retitle('i1', 'B2') });
    expect(titles(t)).toEqual(['A2', 'B2']);
    expect(await bad).toBe(false);
    expect(titles(t)).toEqual(['A', 'B2']);
    expect(t.c.state.error).toBe('Refusé');
  });

  it('garde la modification à l\'écran tant que Linear ne la relit pas, puis cède à Linear', async () => {
    const t = linearSetup();
    await t.c.start();
    // Linear confirme l'écriture, mais ses relectures ne la montrent pas encore.
    await t.c.mutate(linearWrite(), { preview: retitle('i0', 'A2') });
    await flush();
    expect(t.api.resync).toHaveBeenCalledTimes(3);
    expect(titles(t)).toEqual(['A2', 'B']);
    // Une interrogation qui la relit : plus rien à superposer.
    t.writeInLinear('i0', 'A2');
    t.api.snapshot.mockResolvedValueOnce(snap(3, issues('A2', 'B')));
    await t.tick();
    expect(titles(t)).toEqual(['A2', 'B']);
    // Plus rien n'est rejoué : un changement fait ailleurs s'affiche tel quel.
    t.api.snapshot.mockResolvedValueOnce(snap(4, issues('A-ailleurs', 'B')));
    await t.tick();
    expect(titles(t)).toEqual(['A-ailleurs', 'B']);
  });

  it('abandonne une modification jamais relue après OVERLAY_MS', async () => {
    const t = linearSetup();
    await t.c.start();
    await t.c.mutate(linearWrite(), { preview: retitle('i0', 'A2') });
    await flush();
    t.advance(OVERLAY_MS + 1);
    t.api.snapshot.mockResolvedValueOnce(snap(3, issues('Autre', 'B')));
    await t.tick();
    expect(titles(t)).toEqual(['Autre', 'B']);
  });

  it('une interrogation pendant la file garde les modifications en attente à l\'écran', async () => {
    const t = linearSetup();
    await t.c.start();
    const linearCall = deferred();
    const done = t.c.mutate(() => linearCall.promise, { preview: retitle('i0', 'A2') });
    t.api.snapshot.mockResolvedValueOnce(snap(3, issues('A', 'B-ailleurs')));
    await t.tick();
    expect(titles(t)).toEqual(['A2', 'B-ailleurs']);
    linearCall.resolve({ sync: {} });
    await done;
  });
});
