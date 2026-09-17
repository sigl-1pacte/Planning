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
    // pg_advisory_lock est lié à la connexion (session) qui l'a posé, pas à
    // la requête ni à une transaction : le prendre et le relâcher via deux
    // appels db.query() séparés risque de tomber sur deux connexions
    // différentes du pool, et l'unlock échoue silencieusement (avertissement
    // Postgres "you don't own a lock..."). reserve() épingle une connexion
    // unique pour toute la durée du verrou.
    async reserve() {
      const client = await sql.reserve();
      return { ...wrap(client), release: () => client.release() };
    },
    end: () => sql.end({ timeout: 5 }),
  };
}
