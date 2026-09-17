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

`npm start` reste une option (un seul process, l'API sert aussi le build) mais
le déploiement réel de ce projet sépare les deux : le front sur Vercel, l'API
sur Supabase (Postgres + Edge Function). Voir ci-dessous.

## Déploiement

### Front (Vercel)

Paramètres du projet Vercel :

- **Root Directory** : `./`
- **Build Command** : `npm run build`
- **Output Directory** : `dist/ui`
- **Install Command** : `npm install`
- **Environment Variables** : `VITE_API_BASE_URL` = l'URL de la fonction API déployée
  (voir ci-dessous), ex. `https://<project-ref>.supabase.co/functions/v1/api`.
  Sans elle, le front appelle des chemins relatifs (`/api/...`), qui n'existent
  pas sur Vercel — l'app charge mais aucun appel API n'aboutit.

Vercel déploie la branche configurée dans Project Settings → Git → Production
Branch : vérifier que c'est bien la branche qui contient le code de l'app
(`git log --oneline <branche>` doit remonter plus qu'un commit initial), sans
quoi le build échoue avec `Could not read package.json`.

### API (Supabase)

Le serveur Fastify (`src/server`, `npm run dev:server`) reste le chemin de
développement local — le plus simple, le plus rapide à itérer. Ce qui est
réellement déployé est son port en Edge Function : `supabase/functions/api/`
(Deno + Hono, mêmes routes, même logique métier, réutilisée telle quelle
depuis `src/server/linear/*`, `src/server/db/repo.js`, `src/shared/*` — voir
les commentaires en tête de `supabase/functions/api/index.ts` pour le détail
de ce qui change et pourquoi).

Prérequis : un projet Supabase (créé sur [supabase.com](https://supabase.com)),
et le [CLI Supabase](https://supabase.com/docs/guides/cli) (`npx supabase` marche
aussi, sans installation globale).

```bash
npx supabase login
npx supabase link --project-ref <project-ref>       # trouvable dans l'URL du dashboard
npx supabase db push                                 # applique supabase/migrations/*.sql
npx supabase functions deploy api --no-verify-jwt     # verify_jwt=false est déjà dans supabase/config.toml,
                                                       # --no-verify-jwt le confirme explicitement au déploiement
```

Configurer, dans Project Settings → Edge Functions → Secrets (ou
`npx supabase secrets set`) :

- `ALLOWED_ORIGIN` = l'URL du front Vercel (ex. `https://planning.vercel.app`)
  — sans elle, CORS bloque toutes les requêtes du navigateur.

`SUPABASE_DB_URL` est déjà fourni automatiquement par Supabase à ses Edge
Functions, pas besoin de le configurer.

Ensuite, reporter l'URL de la fonction (`https://<project-ref>.supabase.co/functions/v1/api`)
dans `VITE_API_BASE_URL` côté Vercel (ci-dessus), et redéployer le front.

### Vérifier avant de déployer pour de vrai

```bash
npx supabase start   # stack locale complète (Docker), pour tester sans toucher le projet distant
npx supabase functions serve api
curl http://localhost:54321/functions/v1/api/api/health
```
