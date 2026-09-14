// tests/server/sync/snapshotStore.test.js
import { describe, it, expect, vi } from 'vitest';
import { createSnapshotStore } from '../../../src/server/sync/snapshotStore.js';
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from '../../../src/server/linear/client.js';
import { rawWorkspace } from '../../fixtures/workspace.js';

function setup(over = {}) {
  let t = Date.UTC(2026, 8, 14, 10, 0, 0);
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const deps = {
    fetchWorkspace: vi.fn(async () => rawWorkspace()),
    fetchIssuesSince: vi.fn(async () => []),
    onSync: vi.fn(async () => {}),
    onFullSync: vi.fn(async () => {}),
    ...over,
  };
  const store = createSnapshotStore({ ...deps, now: clock.now });
  return { store, clock, deps };
}

describe('snapshotStore', () => {
  it('fait une synchronisation complète au premier appel', async () => {
    const { store, deps } = setup();
    const s = await store.get('k');
    expect(s.version).toBe(1);
    expect(s.stale).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.fetchedAt).toBe('2026-09-14T10:00:00.000Z');
    expect(s.domain.issues).toHaveLength(4);
    expect(deps.fetchWorkspace).toHaveBeenCalledWith('k');
    expect(deps.onSync).toHaveBeenCalledWith(s.domain);
    expect(deps.onFullSync).toHaveBeenCalledOnce();
  });

  it('sert le cache sans appeler Linear avant 45 secondes', async () => {
    const { store, clock, deps } = setup();
    await store.get('k');
    clock.advance(44_000);
    await store.get('k');
    expect(deps.fetchWorkspace).toHaveBeenCalledOnce();
    expect(deps.fetchIssuesSince).not.toHaveBeenCalled();
    expect(store.current().version).toBe(1);
  });

  it('fusionne les issues modifiées et incrémente la version', async () => {
    const changed = { ...rawWorkspace().issues[0], title: 'Conception revue' };
    const { store, clock, deps } = setup({ fetchIssuesSince: vi.fn(async () => [changed]) });
    await store.get('k');
    clock.advance(46_000);
    const s = await store.get('k');
    expect(deps.fetchIssuesSince).toHaveBeenCalledWith('k', '2026-09-14T09:59:55.000Z');
    expect(s.version).toBe(2);
    expect(s.domain.issues.find((i) => i.id === 'i-11').title).toBe('Conception revue');
    expect(s.domain.issues).toHaveLength(4);
    expect(deps.onFullSync).toHaveBeenCalledOnce();
  });

  it('garde la version quand rien n’a changé', async () => {
    const { store, clock } = setup();
    await store.get('k');
    clock.advance(46_000);
    expect((await store.get('k')).version).toBe(1);
  });

  it('retire une issue archivée reçue en incrémental', async () => {
    const archived = { ...rawWorkspace().issues[2], archivedAt: '2026-09-14T10:00:30.000Z' };
    const { store, clock } = setup({ fetchIssuesSince: vi.fn(async () => [archived]) });
    await store.get('k');
    clock.advance(46_000);
    expect((await store.get('k')).domain.issues.map((i) => i.id)).not.toContain('i-13');
  });

  it('refait une synchronisation complète après dix minutes et détecte les suppressions', async () => {
    const smaller = rawWorkspace();
    smaller.issues.pop();
    const fetchWorkspace = vi.fn().mockResolvedValueOnce(rawWorkspace()).mockResolvedValueOnce(smaller);
    const { store, clock, deps } = setup({ fetchWorkspace });
    await store.get('k');
    clock.advance(600_000);
    const s = await store.get('k');
    expect(fetchWorkspace).toHaveBeenCalledTimes(2);
    expect(s.domain.issues.map((i) => i.id)).not.toContain('i-20');
    expect(s.version).toBe(2);
    expect(deps.onFullSync).toHaveBeenCalledTimes(2);
  });

  it('ne lance qu’un seul rafraîchissement pour des appels simultanés', async () => {
    let release;
    const fetchWorkspace = vi.fn(() => new Promise((resolve) => { release = () => resolve(rawWorkspace()); }));
    const { store } = setup({ fetchWorkspace });
    const all = Promise.all([store.get('k'), store.get('k'), store.get('k')]);
    await Promise.resolve();
    release();
    const snaps = await all;
    expect(fetchWorkspace).toHaveBeenCalledOnce();
    expect(snaps.map((s) => s.version)).toEqual([1, 1, 1]);
  });

  it('sert l’ancien instantané marqué périmé si Linear est injoignable', async () => {
    const fetchIssuesSince = vi.fn(async () => { throw new LinearUnavailableError('Linear a répondu 503'); });
    const { store, clock } = setup({ fetchIssuesSince });
    await store.get('k');
    clock.advance(46_000);
    const s = await store.get('k');
    expect(s.version).toBe(1);
    expect(s.stale).toBe(true);
    expect(s.lastError).toBe('Linear a répondu 503');
    expect(s.fetchedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('retente seulement après 45 secondes quand Linear est injoignable', async () => {
    const fetchIssuesSince = vi.fn(async () => { throw new LinearUnavailableError(); });
    const { store, clock } = setup({ fetchIssuesSince });
    await store.get('k');
    clock.advance(46_000);
    await store.get('k');
    await store.get('k');
    expect(fetchIssuesSince).toHaveBeenCalledOnce();
  });

  it('propage l’erreur quand il n’existe encore aucun instantané', async () => {
    const { store } = setup({ fetchWorkspace: vi.fn(async () => { throw new LinearUnavailableError(); }) });
    await expect(store.get('k')).rejects.toBeInstanceOf(LinearUnavailableError);
    expect(store.current()).toBeNull();
  });

  it('propage toujours une clé invalide', async () => {
    const fetchIssuesSince = vi.fn(async () => { throw new LinearAuthError(); });
    const { store, clock } = setup({ fetchIssuesSince });
    await store.get('k');
    clock.advance(46_000);
    await expect(store.get('k')).rejects.toBeInstanceOf(LinearAuthError);
  });

  it('se met en pause pendant cinq minutes après un dépassement de quota', async () => {
    const fetchIssuesSince = vi.fn(async () => { throw new LinearRateLimitError(); });
    const { store, clock } = setup({ fetchIssuesSince });
    await store.get('k');
    clock.advance(46_000);
    expect((await store.get('k')).lastError).toBe('Quota Linear dépassé');
    clock.advance(60_000);
    await store.forceRefresh('k');
    expect(fetchIssuesSince).toHaveBeenCalledOnce();
    clock.advance(300_000);
    await store.get('k');
    expect(fetchIssuesSince).toHaveBeenCalledTimes(2);
  });

  it('force un cycle immédiat', async () => {
    const { store, clock, deps } = setup();
    await store.get('k');
    clock.advance(1_000);
    await store.forceRefresh('k');
    expect(deps.fetchIssuesSince).toHaveBeenCalledOnce();
  });

  it('propage une erreur de onSync sans marquer l’instantané périmé', async () => {
    const onSync = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { store } = setup({ onSync });
    await expect(store.get('k')).rejects.toThrow('ECONNREFUSED');
    const s = store.current();
    expect(s.version).toBe(1);
    expect(s.stale).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('propage une erreur de onFullSync sans marquer l’instantané périmé', async () => {
    const onFullSync = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { store, deps } = setup({ onFullSync });
    await expect(store.get('k')).rejects.toThrow('ECONNREFUSED');
    const s = store.current();
    expect(s.version).toBe(1);
    expect(s.stale).toBe(false);
    expect(s.lastError).toBeNull();
    expect(deps.onSync).toHaveBeenCalledOnce();
  });

  it('efface l’état périmé au cycle réussi suivant', async () => {
    const fetchIssuesSince = vi.fn()
      .mockRejectedValueOnce(new LinearUnavailableError())
      .mockResolvedValueOnce([]);
    const { store, clock } = setup({ fetchIssuesSince });
    await store.get('k');
    clock.advance(46_000);
    await store.get('k');
    clock.advance(46_000);
    const s = await store.get('k');
    expect(s.stale).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.fetchedAt).toBe('2026-09-14T10:01:32.000Z');
  });
});
