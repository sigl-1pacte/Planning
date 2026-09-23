import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { ensurePeople, purgeContributions } from './db/repo.js';
import { createKeyValidator } from './auth.js';
import { createSnapshotStore } from './sync/snapshotStore.js';
import { registerDiagnosticRoute } from './diagnostic.js';
import {
  fetchWorkspace, fetchIssuesSince, fetchViewer, fetchDiagnosticSample,
} from './linear/queries.js';

const { DATABASE_URL, PORT = '3000', LOG_LEVEL = 'info' } = process.env;

function databaseStep(step) {
  return async (domain) => {
    try {
      await step(domain);
    } catch (err) {
      console.error('Base de données inaccessible pendant la synchronisation :', err.message);
      throw Object.assign(new Error('Base de données inaccessible'), { statusCode: 503 });
    }
  };
}

if (!DATABASE_URL) {
  console.error('DATABASE_URL est absente : impossible de démarrer sans la base de planification.');
  process.exit(1);
}

const db = createPool(DATABASE_URL, {
  onError: (err) => console.error('PostgreSQL : client inactif en erreur :', err.message),
});

let applied;
try {
  applied = await migrate(db);
} catch (err) {
  console.error('Migrations impossibles, arrêt du service :', err.message);
  await db.end().catch(() => {});
  process.exit(1);
}

const store = createSnapshotStore({
  fetchWorkspace: (key) => fetchWorkspace(key),
  fetchIssuesSince: (key, since) => fetchIssuesSince(key, since),
  onSync: databaseStep((domain) => ensurePeople(db, domain.users.map((u) => u.id))),
  onFullSync: databaseStep((domain) => purgeContributions(
    db,
    domain.issues.flatMap((i) => i.contributorIds.map((linearUserId) => ({ issueId: i.id, linearUserId }))),
  )),
});

const staticPath = fileURLToPath(new URL('../../dist/ui', import.meta.url));

const app = buildApp({
  db,
  store,
  validateKey: createKeyValidator({ fetchViewer: (key) => fetchViewer(key) }),
  staticDir: existsSync(staticPath) ? staticPath : null,
  logger: { level: LOG_LEVEL, redact: ['req.headers["x-linear-key"]'] },
});
registerDiagnosticRoute(app, { fetchDiagnosticSample: (key, limit) => fetchDiagnosticSample(key, limit) });

app.log.info({ migrations: applied }, 'migrations appliquées');
await app.listen({ host: '0.0.0.0', port: Number(PORT) });

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
