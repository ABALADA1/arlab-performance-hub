drop table if exists public.arlab_gps_manifest;
drop table if exists public.arlab_state_snapshots;
-- Storage buckets are intentionally not deleted during rollback to avoid deleting files.
