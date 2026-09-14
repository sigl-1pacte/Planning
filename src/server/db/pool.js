import pg from 'pg';

export function createPool(connectionString, { onError = () => {} } = {}) {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  // Sans écouteur, l'erreur d'un client inactif (base redémarrée) ferait tomber le processus.
  pool.on('error', onError);
  const wrap = (client) => ({
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrap(client));
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
