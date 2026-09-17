// Connecteur Postgres pour l'Edge Function, avec la même interface que
// src/server/db/pool.js ({ query(sql, params) => { rows }, transaction(fn) })
// pour que src/server/db/repo.js (aucune dépendance Node) se réutilise sans
// aucune modification. Pilote différent (postgres, pas pg) : pg s'appuie sur
// des internes réseau Node non garantis en Deno/Edge ; postgres (porsager)
// est celui recommandé par Supabase pour les Edge Functions qui parlent
// directement à Postgres.
import postgres from 'npm:postgres@3';

export function createPool(connectionString: string) {
  const sql = postgres(connectionString, { prepare: false });

  const wrap = (client: any) => ({
    async query(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, params as never[]);
      return { rows: [...rows] };
    },
  });

  return {
    ...wrap(sql),
    async transaction<T>(fn: (tx: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }) => Promise<T>) {
      return sql.begin(async (tx: any) => fn(wrap(tx)));
    },
    end: () => sql.end({ timeout: 5 }),
  };
}
