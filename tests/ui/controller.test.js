import { describe, it, expect, vi } from 'vitest';
import { createController, POLL_MS } from '../../src/ui/controller.js';
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

  it('retient la modification commencée en dernier entre deux modifications concurrentes', async () => {
    const api = { getKey: () => 'k', snapshot: vi.fn(async () => snap(1)), planning: vi.fn(async () => ({ v: 0 })) };
    const t = setup(api);
    await t.c.start();
    const first = deferred();
    const second = deferred();
    const m1 = t.c.mutate(() => first.promise);
    const m2 = t.c.mutate(() => second.promise);
    second.resolve({ v: 2 });
    await m2;
    first.resolve({ v: 1 });
    await m1;
    expect(t.c.state.planning).toEqual({ v: 2 });
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
