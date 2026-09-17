import { readdir, readFile } from 'node:fs/promises';

export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export async function migrate(db, dir = MIGRATIONS_DIR) {
  await db.query(`create table if not exists schema_migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await db.query('select name from schema_migration')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migration (name) values ($1)', [file]);
    });
    done.push(file);
  }
  return done;
}
