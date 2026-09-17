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

  async function cycle(key, forceFull) {
    const startedAt = now();
    lastAttemptAt = startedAt;
    const full = forceFull || raw === null || startedAt - lastFullAt >= fullEveryMs;
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
    } catch (err) {
      if (err instanceof LinearAuthError) throw err;
      if (err instanceof LinearRateLimitError) backoffUntil = startedAt + backoffMs;
      lastError = err.message;
      if (domain === null) throw err;
      return;
    }
    await onSync(domain);
    if (full) await onFullSync(domain);
  }

  function refresh(key, forceFull) {
    inFlight ??= cycle(key, forceFull).finally(() => { inFlight = null; });
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
      if (due && t >= backoffUntil) await refresh(key, false);
      else if (inFlight) await inFlight;
      return result();
    },
    // full: true force une synchronisation complète même si le dernier cycle
    // complet date de moins de dix minutes. Un cycle incrémental filtre les
    // issues par updatedAt côté Linear, qui ne bouge pas pour tout ce qui
    // n'est pas un champ suivi ici (par ex. un commentaire quelconque ajouté
    // sur le ticket). Le bouton « Actualiser » et la route /api/refresh
    // demandent donc explicitement un cycle complet ; les rafraîchissements
    // après une écriture restent incrémentaux (rapides), l'écriture
    // elle-même ayant déjà mis à jour ce qui vient de changer.
    async forceRefresh(key, { full = false } = {}) {
      if (now() >= backoffUntil) await refresh(key, full);
      return result();
    },
    current() {
      return domain === null ? null : snapshot();
    },
  };
}
