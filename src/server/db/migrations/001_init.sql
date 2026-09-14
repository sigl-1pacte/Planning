create table settings (
  singleton            boolean primary key default true check (singleton),
  hours_per_point      numeric not null default 5 check (hours_per_point > 0),
  load_ceiling_pct     integer not null default 80 check (load_ceiling_pct between 10 and 200),
  default_weekly_hours numeric not null default 28 check (default_weekly_hours >= 0),
  updated_at           timestamptz not null default now()
);
insert into settings default values;

create table holiday (
  day   date primary key,
  label text not null
);
insert into holiday (day, label) values
  ('2026-11-11', 'Armistice'),
  ('2026-12-25', 'Noël'),
  ('2027-01-01', 'Jour de l''an');

create table person (
  linear_user_id       text primary key,
  role                 text,
  default_weekly_hours numeric check (default_weekly_hours >= 0),
  active               boolean not null default true
);

create table weekly_capacity (
  linear_user_id text not null references person on delete cascade,
  week_start     date not null check (extract(isodow from week_start) = 1),
  hours          numeric not null check (hours >= 0),
  primary key (linear_user_id, week_start)
);

create table contribution (
  issue_id       text not null,
  linear_user_id text not null,
  share          numeric not null check (share >= 0),
  primary key (issue_id, linear_user_id)
);
