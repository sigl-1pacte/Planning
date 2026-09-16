# Planning
le planning de 1PACTE

## Lancer en local

Prérequis : Node ≥ 22.

```bash
git clone <url-du-repo>
cd Planning
npm install
```

Il faut ensuite une base PostgreSQL joignable via `DATABASE_URL`. Deux options :

### Option A — vous avez déjà un Postgres (docker, cloud, local...)

```bash
export DATABASE_URL="postgres://<user>:<password>@<host>:<port>/<db>"
```

### Option B — sans Docker, base locale jetable (PGlite)

Utile pour développer sans rien installer de plus. Dans un premier terminal :

```bash
npm install -g @electric-sql/pglite-socket
pglite-server -d file://./.pglite-data -p 5433
```

Dans un second terminal :

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5433/postgres"
```

(`./.pglite-data` persiste les données entre deux lancements ; `memory://` à la
place pour une base jetée à chaque redémarrage.)

### Démarrer l'app

Deux processus, dans deux terminaux (avec `DATABASE_URL` exporté dans celui du serveur) :

```bash
npm run dev:server   # API + sync Linear, http://localhost:3000
npm run dev:ui       # front Vite, http://localhost:5173 (proxy /api vers le serveur)
```

Les migrations SQL s'appliquent automatiquement au démarrage du serveur.
Ouvrez `http://localhost:5173` : l'app demande une clé API Linear personnelle
au premier lancement (stockée uniquement dans le navigateur, jamais côté
serveur).

### Tests

```bash
npm test
```

## Build de production

```bash
npm run build   # écrit dans dist/ui
npm start       # sert l'API + le build (DATABASE_URL requis)
```
