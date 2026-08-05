-- AVIARA-to-AVIARA pilot reports (PIREPs). Deliberately NOT the FAA
-- reporting chain — these are shared only between AVIARA users, drawn on
-- the map for anyone with the PIREPs layer on. Structured columns rather
-- than a text blob so the layer can filter/expire them by time and the
-- popup can render severity without parsing.
--
-- Additive only: new table, no changes to anything existing.
create table if not exists pireps (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade: deleting an account takes its reports with it.
  user_id uuid references auth.users(id) on delete cascade not null,
  lat double precision not null,
  lon double precision not null,
  altitude_ft integer,
  aircraft_type text,
  -- UUA (urgent) vs UA (routine), the standard's own top-level split.
  urgent boolean not null default false,
  -- Standard PIREP element groups, constrained to the standard's own
  -- vocabulary so a client bug can't write junk other clients then render.
  sky text check (sky in ('CLR','FEW','SCT','BKN','OVC')),
  wx text[] not null default '{}',
  turbulence text check (turbulence in ('NEG','LGT','MOD','SEV','EXTM')),
  icing text check (icing in ('NEG','TRACE','LGT','MOD','SEV')),
  remarks text,
  created_at timestamptz not null default now()
);

alter table pireps enable row level security;

-- Same PostgREST reality as the backups table: RLS restricts rows, but the
-- base grant must exist first or every request 403s before RLS runs.
grant select, insert, delete on pireps to authenticated;

-- Readable by every signed-in pilot — that is the entire point of a PIREP.
create policy "pireps are visible to all signed-in pilots"
  on pireps for select to authenticated using (true);

create policy "pilots file their own pireps"
  on pireps for insert with check (auth.uid() = user_id);

create policy "pilots delete their own pireps"
  on pireps for delete using (auth.uid() = user_id);

-- The map layer only ever asks "recent ones" — index the time axis.
create index if not exists pireps_created_at_idx on pireps(created_at);
