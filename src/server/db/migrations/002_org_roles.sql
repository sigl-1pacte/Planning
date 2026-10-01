-- Organisation : un Product Owner et un Scrum Master par team, et un manager
-- global. Linear n'a pas ces notions ; les teams et personnes sont des ids
-- Linear, sans clé étrangère (comme contribution).
create table team_role (
  team_id        text not null,
  role           text not null check (role in ('product_owner', 'scrum_master')),
  linear_user_id text not null,
  primary key (team_id, role)
);

alter table settings add column manager_user_id text;
