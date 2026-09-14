// src/server/sync/snapshotStore.js
import { createHash } from 'node:crypto';
import { mapWorkspace } from '../linear/mapper.js';
import { LinearAuthError, LinearRateLimitError } from '../linear/client.js';

const CLOCK_SKEW_MS = 5_000;

export function createSnapshotStore({
  fetchWorkspace,
  fetchIssuesSince,
  onSync = async () => {},
  onFullSync = async () => {},
  now = () => Date.now(),
  ttlMs = 45_000,
  fullEveryMs = 600_000,
  backoffMs = 300_000,
}) {
  let raw = null;
  let domain = null;
  let hash = null;
  let version = 0;
  let fetchedAt = null;
  let lastSyncAt = null;
  let lastFullAt = null;
  let lastAttemptAt = null;
  let backoffUntil = 0;
  let lastError = null;
  let inFlight = null;

  const snapshot = () => ({
    version,
    fetchedAt: new Date(fetchedAt).toISOString(),
    stale: lastError !== null,
    lastError,
    domain,
  });

  async function cycle(key) {
    const startedAt = now();
    lastAttemptAt = startedAt;
    const full = raw === null || startedAt - lastFullAt >= fullEveryMs;
    try {
      if (full) {
        raw = await fetchWorkspace(key);
        lastFullAt = startedAt;
      } else {
        const since = new Date(lastSyncAt - CLOCK_SKEW_MS).toISOString();
        const changed = await fetchIssuesSince(key, since);
        const issues = new Map(raw.issues.map((i) => [i.id, i]));
        for (const issue of changed) {
          if (issue.archivedAt) issues.delete(issue.id);
          else issues.set(issue.id, issue);
        }
        raw = { ...raw, issues: [...issues.values()] };
      }
      lastSyncAt = startedAt;
      fetchedAt = startedAt;
      lastError = null;

      const next = mapWorkspace(raw);
      const nextHash = createHash('sha1').update(JSON.stringify(next)).digest('hex');
      if (nextHash !== hash) {
        hash = nextHash;
        domain = next;
        version += 1;
      }
      await onSync(domain);
      if (full) await onFullSync(domain);
    } catch (err) {
      if (err instanceof LinearAuthError) throw err;
      if (err instanceof LinearRateLimitError) backoffUntil = startedAt + backoffMs;
      lastError = err.message;
      if (domain === null) throw err;
    }
  }

  function refresh(key) {
    inFlight ??= cycle(key).finally(() => { inFlight = null; });
    return inFlight;
  }

  function result() {
    if (domain === null) throw new Error(lastError ?? 'Instantané indisponible');
    return snapshot();
  }

  return {
    async get(key) {
      const t = now();
      const due = domain === null || lastAttemptAt === null || t - lastAttemptAt >= ttlMs;
      if (due && t >= backoffUntil) await refresh(key);
      else if (inFlight) await inFlight;
      return result();
    },
    async forceRefresh(key) {
      if (now() >= backoffUntil) await refresh(key);
      return result();
    },
    current() {
      return domain === null ? null : snapshot();
    },
  };
}
