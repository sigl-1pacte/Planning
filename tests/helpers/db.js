import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../src/server/db/migrate.js';

export async function createTestDb() {
  const db = await PGlite.create();
  await migrate(db);
  return db;
}
