create table if not exists public.arlab_state_snapshots (
  slot text primary key check (slot in ('current','last-good','previous-1','previous-2')),
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  import_token text not null default '',
  bytes bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists arlab_state_snapshots_updated_at_idx
  on public.arlab_state_snapshots(updated_at desc);

create table if not exists public.arlab_gps_manifest (
  id text primary key default 'current',
  payload jsonb not null default '{"version":1,"gpsState":{"gpsRawLogs":[],"gpsCutSessions":[]},"rawFiles":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.arlab_gps_manifest(id)
values ('current')
on conflict (id) do nothing;

-- Storage buckets for ARLAB heavy files. Other columns use Nhost defaults.
insert into storage.buckets(id) values ('arlab-data') on conflict (id) do nothing;
insert into storage.buckets(id) values ('arlab-gps') on conflict (id) do nothing;

comment on table public.arlab_state_snapshots is
  'ARLAB state with fixed retention: current + last-good + previous-1 + previous-2.';
comment on table public.arlab_gps_manifest is
  'Current GPS manifest. Raw GPS files are stored in Nhost Storage bucket arlab-gps.';
