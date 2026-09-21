import { describe, it, expect, vi } from 'vitest';
import { refreshUntil } from '../../../src/server/sync/refreshUntil.js';

const withProject = (id) => ({ domain: { projects: id ? [{ id }] : [] } });
const has = (d) => d.projects.some((p) => p.id === 'p-new');

describe('refreshUntil', () => {
  it('s\'arrête dès que l\'élément créé est présent, en synchronisation complète', async () => {
    const store = { forceRefresh: vi.fn(async () => withProject('p-new')) };
    const snap = await refreshUntil(store, 'k', has, { delayMs: 0 });
    expect(store.forceRefresh).toHaveBeenCalledOnce();
    expect(store.forceRefresh).toHaveBeenCalledWith('k', { full: true });
    expect(has(snap.domain)).toBe(true);
  });

  it('relance tant que Linear ne renvoie pas encore l\'élément', async () => {
    const store = { forceRefresh: vi.fn()
      .mockResolvedValueOnce(withProject(null))
      .mockResolvedValueOnce(withProject('p-new')) };
    const snap = await refreshUntil(store, 'k', has, { delayMs: 0 });
    expect(store.forceRefresh).toHaveBeenCalledTimes(2);
    expect(has(snap.domain)).toBe(true);
  });

  it('rend le dernier instantané après le nombre d\'essais, sans erreur', async () => {
    const store = { forceRefresh: vi.fn(async () => withProject(null)) };
    const snap = await refreshUntil(store, 'k', has, { attempts: 3, delayMs: 0 });
    expect(store.forceRefresh).toHaveBeenCalledTimes(3);
    expect(has(snap.domain)).toBe(false);
  });
});
