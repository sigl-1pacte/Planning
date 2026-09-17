// Équivalent Postgres de src/server/sync/snapshotStore.js (gardé tel quel
// pour le serveur Fastify de dev, qui est un process long-lived où un cache
// en mémoire suffit). Une Edge Function n'a aucune garantie de mémoire
// partagée entre deux invocations, donc tout l'état (payload Linear brut,
// domaine mappé, hash/version, horodatages, backoff) vit dans la table
// linear_snapshot (une seule ligne, id='default') plutôt que dans des
// variables de fermeture. Même algorithme que l'original, section par
// section ; seule différence réelle : la dé-duplication des requêtes
// concurrentes (inFlight, une promesse partagée en mémoire côté Fastify) est
// remplacée par un verrou consultatif Postgres (pg_try_advisory_lock) — une
// invocation qui ne l'obtient pas relit simplement la ligne courante au lieu
// d'attendre, plutôt que de bloquer sans mécanisme de partage possible entre
// invocations séparées.
import { mapWorkspace } from '../../../src/server/linear/mapper.js';
import { LinearAuthError, LinearRateLimitError } from '../../../src/server/linear/client.js';

const CLOCK_SKEW_MS = 5_000;
const ADVISORY_LOCK_KEY = 847_362_910; // arbitraire, propre à ce cache

type Row = {
  raw: any;
  domain: any;
  hash: string | null;
  version: number;
  fetched_at: string | null;
  last_sync_at: string | null;
  last_full_at: string | null;
  last_attempt_at: string | null;
  backoff_until: string;
  last_error: string | null;
};

async function sha1(value: string) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadRow(db: any): Promise<Row> {
  const { rows } = await db.query('select * from linear_snapshot where id = $1', ['default']);
  return rows[0];
}

async function saveRow(db: any, patch: Partial<Row>) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => {
    const v = (patch as any)[f];
    return f === 'raw' || f === 'domain' ? (v === null ? null : JSON.stringify(v)) : v;
  });
  await db.query(`update linear_snapshot set ${sets} where id = $1`, ['default', ...values]);
}

export function createSnapshotStore({
  fetchWorkspace,
  fetchIssuesSince,
  onSync = async (_domain: unknown) => {},
  onFullSync = async (_domain: unknown) => {},
  now = () => Date.now(),
  ttlMs = 45_000,
  fullEveryMs = 600_000,
  backoffMs = 300_000,
}: {
  fetchWorkspace: (key: string) => Promise<unknown>;
  fetchIssuesSince: (key: string, since: string) => Promise<any[]>;
  onSync?: (domain: unknown) => Promise<void>;
  onFullSync?: (domain: unknown) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
  fullEveryMs?: number;
  backoffMs?: number;
}, db: any) {
  const snapshot = (row: Row) => ({
    version: row.version,
    fetchedAt: new Date(row.fetched_at ?? row.last_attempt_at ?? now()).toISOString(),
    stale: row.last_error !== null,
    lastError: row.last_error,
    domain: row.domain,
  });

  function result(row: Row) {
    if (row.domain === null) throw new Error(row.last_error ?? 'Instantané indisponible');
    return snapshot(row);
  }

  async function cycle(key: string, forceFull: boolean) {
    const startedAt = now();
    let row = await loadRow(db);
    const raw = row.raw as any;
    const full = forceFull || raw === null || startedAt - new Date(row.last_full_at ?? 0).getTime() >= fullEveryMs;
    const patch: Partial<Row> = { last_attempt_at: new Date(startedAt).toISOString() };
    try {
      let nextRaw = raw;
      if (full) {
        nextRaw = await fetchWorkspace(key);
        patch.last_full_at = new Date(startedAt).toISOString();
      } else {
        const since = new Date(new Date(row.last_sync_at as string).getTime() - CLOCK_SKEW_MS).toISOString();
        const changed = await fetchIssuesSince(key, since);
        const issues = new Map(raw.issues.map((i: any) => [i.id, i]));
        for (const issue of changed) {
          if (issue.archivedAt) issues.delete(issue.id);
          else issues.set(issue.id, issue);
        }
        nextRaw = { ...raw, issues: [...issues.values()] };
      }
      patch.raw = nextRaw;
      patch.last_sync_at = new Date(startedAt).toISOString();
      patch.fetched_at = new Date(startedAt).toISOString();
      patch.last_error = null;

      const next = mapWorkspace(nextRaw as any);
      const nextHash = await sha1(JSON.stringify(next));
      if (nextHash !== row.hash) {
        patch.hash = nextHash;
        patch.domain = next;
        patch.version = row.version + 1;
      }
    } catch (err: any) {
      await saveRow(db, patch);
      if (err instanceof LinearAuthError) throw err;
      if (err instanceof LinearRateLimitError) patch.backoff_until = new Date(startedAt + backoffMs).toISOString();
      patch.last_error = err.message;
      await saveRow(db, { backoff_until: patch.backoff_until, last_error: patch.last_error });
      row = await loadRow(db);
      if (row.domain === null) throw err;
      return;
    }
    await saveRow(db, patch);
    row = await loadRow(db);
    await onSync(row.domain);
    if (full) await onFullSync(row.domain);
  }

  // Verrou consultatif : évite que deux invocations concurrentes déclenchent
  // chacune leur propre appel à Linear pendant la même fenêtre de
  // rafraîchissement. Celle qui n'obtient pas le verrou renvoie l'état
  // courant plutôt que d'attendre (pas de canal pour partager une promesse
  // entre invocations séparées, contrairement au process Fastify).
  async function refresh(key: string, forceFull: boolean) {
    const { rows } = await db.query('select pg_try_advisory_lock($1) as ok', [ADVISORY_LOCK_KEY]);
    if (!rows[0].ok) return;
    try {
      await cycle(key, forceFull);
    } finally {
      await db.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  }

  return {
    async get(key: string) {
      const row = await loadRow(db);
      const t = now();
      const backoffUntil = new Date(row.backoff_until).getTime();
      const due = row.domain === null || row.last_attempt_at === null || t - new Date(row.last_attempt_at).getTime() >= ttlMs;
      if (due && t >= backoffUntil) await refresh(key, false);
      return result(await loadRow(db));
    },
    async forceRefresh(key: string, { full = false } = {}) {
      const row = await loadRow(db);
      if (now() >= new Date(row.backoff_until).getTime()) await refresh(key, full);
      return result(await loadRow(db));
    },
    async current() {
      const row = await loadRow(db);
      return row.domain === null ? null : snapshot(row);
    },
  };
}
