-- KIO — Supabase schema
-- Run this in the Supabase SQL editor.

-- 1) Per-IP daily quota -----------------------------------------------------
create table if not exists kio_quota (
  ip        text not null,
  day       date not null default current_date,
  count     int  not null default 0,
  primary key (ip, day)
);

-- Atomic bump: increment today's count for an IP, return the new value.
create or replace function kio_bump_quota(p_ip text)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  insert into kio_quota (ip, day, count)
  values (p_ip, current_date, 1)
  on conflict (ip, day)
  do update set count = kio_quota.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- 2) Public verdict log -----------------------------------------------------
create table if not exists kio_verdicts (
  id         bigint generated always as identity primary key,
  label      text not null check (label in ('AGREE','PUSHBACK','CORRECTED')),
  prompt     text not null,
  text       text not null,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists kio_verdicts_created_idx
  on kio_verdicts (created_at desc);

-- Optional: auto-clean quota rows older than 7 days (run via cron / pg_cron)
-- delete from kio_quota where day < current_date - interval '7 days';

-- RLS notes:
-- The backend uses the SERVICE key (bypasses RLS), so RLS is optional.
-- If you want the public /verdicts feed to be readable by the anon key too,
-- enable RLS and add a read-only policy on kio_verdicts:
--
-- alter table kio_verdicts enable row level security;
-- create policy "public read verdicts" on kio_verdicts
--   for select using (true);
