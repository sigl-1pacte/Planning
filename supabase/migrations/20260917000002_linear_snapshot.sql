-- Remplace le cache en mémoire de src/server/sync/snapshotStore.js (utilisé
-- par le serveur Fastify de dev, qui reste un process long-lived) par une
-- ligne persistée : supabase/functions/api tourne en Edge Function, sans
-- mémoire garantie entre deux invocations. Une seule ligne (id = 'default')
-- car l'app ne gère qu'un seul workspace Linear à la fois, comme la version
-- en mémoire qu'elle remplace.
create table linear_snapshot (
  id               text primary key default 'default',
  raw              jsonb,
  domain           jsonb,
  hash             text,
  version          integer not null default 0,
  fetched_at       timestamptz,
  last_sync_at     timestamptz,
  last_full_at     timestamptz,
  last_attempt_at  timestamptz,
  backoff_until    timestamptz not null default 'epoch',
  last_error       text
);
insert into linear_snapshot (id) values ('default');
