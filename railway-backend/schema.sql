create extension if not exists pgcrypto;

create table if not exists arlab_player_portal_users (
  id uuid primary key default gen_random_uuid(),
  player_id text not null unique,
  username text not null unique,
  password_hash text,
  display_name text,
  team text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arlab_player_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references arlab_player_portal_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists arlab_player_portal_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references arlab_player_portal_users(id) on delete set null,
  player_id text not null,
  entry_date date not null,
  checkin_entry jsonb,
  wellness_entry jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arlab_player_portal_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references arlab_player_portal_users(id) on delete set null,
  player_id text not null,
  entry_date date not null,
  checkout_entry jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arlab_player_portal_hydration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references arlab_player_portal_users(id) on delete cascade,
  player_id text not null,
  entry_date date not null,
  entry_time time not null,
  amount_ml integer,
  drink_type text,
  urine_scale smallint,
  urine_note text,
  comment text,
  entry jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arlab_player_portal_nutrition_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references arlab_player_portal_users(id) on delete cascade,
  player_id text not null,
  entry_date date not null,
  entry_time time not null default localtime,
  meal_type text not null,
  foods text not null,
  amount text,
  water_ml integer,
  comment text,
  entry jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  photo_paths text[] not null default '{}'::text[]
);

create index if not exists idx_portal_sessions_user on arlab_player_portal_sessions(user_id);
create index if not exists idx_portal_sessions_expiry on arlab_player_portal_sessions(expires_at);
create index if not exists idx_portal_checkins_player_date on arlab_player_portal_checkins(player_id, entry_date);
create index if not exists idx_portal_checkouts_player_date on arlab_player_portal_checkouts(player_id, entry_date);
create index if not exists idx_portal_hydration_player_date on arlab_player_portal_hydration(player_id, entry_date);
create index if not exists idx_portal_meals_player_date on arlab_player_portal_nutrition_meals(player_id, entry_date);
