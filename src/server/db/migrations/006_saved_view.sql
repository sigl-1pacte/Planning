-- Vues enregistrées (filtres de la frise et du kanban), propres à chacun :
-- owner_user_id est l'id Linear de la personne connectée, sans clé
-- étrangère (comme contribution). Le filtre est stocké tel que l'interface
-- le décrit (src/ui/filters.js), validé par les routes.
create table saved_view (
  id            bigint generated always as identity primary key,
  owner_user_id text        not null,
  name          text        not null check (length(name) between 1 and 60),
  filter        jsonb       not null,
  created_at    timestamptz not null default now()
);

create unique index saved_view_owner_name on saved_view (owner_user_id, lower(name));
