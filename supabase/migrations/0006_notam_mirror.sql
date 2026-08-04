-- The NOTAM mirror.
--
-- Today the app asks an authority for one airport's NOTAMs each time a pilot
-- opens the tab. That is a network round trip to Washington or Ottawa while
-- someone is standing on a ramp, and it cannot work at all with no signal.
-- This is the table the backend worker keeps current instead, so a lookup
-- becomes a local query against data that is already there.
--
-- Deliberately not modelled around any one country. The app's ambition is
-- global with US emphasis, so `source` is a first-class column and every
-- authority is just another value in it — adding EASA or anyone else is an
-- adapter in services/aviara-svc/src/sources/, not a migration.
--
-- Additive. Nothing existing is touched.

create table if not exists notams (
  -- A NOTAM number is only unique within the authority that issued it:
  -- 'A0123/26' means different things to the FAA and to NAV CANADA. The
  -- identity is the pair, and every query and upsert goes through it.
  source      text not null,
  notam_id    text not null,

  fir         text,
  -- The A) field: every location this NOTAM applies to. An array rather than
  -- a single ident because one NOTAM routinely covers a whole FIR, and
  -- "which NOTAMs apply at CYYZ" is a containment test, not an equality one.
  affected    text[] not null default '{}',
  scope       text,
  qcode       text,

  -- Derived by the shared parser in src/lib/notamParse.js. Stored rather
  -- than recomputed on read: the client already knows how to render these,
  -- and the whole point of the mirror is that reading is cheap.
  category    text,
  severity    text not null default 'info'
                check (severity in ('closed', 'unserviceable', 'info')),

  starts_at   timestamptz,
  -- null means permanent or "until further notice" — the two are
  -- distinguished by `permanent`, because "no end date recorded" and "will
  -- never end" are different facts.
  ends_at     timestamptz,
  permanent   boolean not null default false,
  estimated   boolean not null default false,

  body        text,
  raw         text not null,

  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),

  primary key (source, notam_id)
);

-- "Everything in force at CYYZ" is the single hottest query in the app, and
-- it is a containment test against the array. GIN is what makes that an index
-- scan instead of 40,000 sequential comparisons.
create index if not exists notams_affected_idx on notams using gin (affected);
create index if not exists notams_ends_at_idx on notams (ends_at);
create index if not exists notams_last_seen_idx on notams (last_seen);
create index if not exists notams_severity_idx on notams (severity);

alter table notams enable row level security;

-- Readable by everyone, signed in or not. NOTAMs are public safety
-- information — the FAA and NAV CANADA both publish them without
-- authentication, and putting a login in front of a runway closure would be
-- indefensible.
grant select on notams to anon, authenticated;

drop policy if exists "notams are publicly readable" on notams;
create policy "notams are publicly readable"
  on notams for select
  using (true);

-- No insert/update/delete grants to anon or authenticated at all. The worker
-- writes with the service role, which bypasses RLS by design; nothing else
-- should ever write here, and the cleanest way to say that is to grant
-- nobody else the privilege in the first place.

-- Upsert that unions `affected` instead of replacing it.
--
-- This exists because of a real failure found in dry-run. A FIR-wide NOTAM is
-- returned for every aerodrome in the FIR, and each fetch only knows about
-- the one aerodrome it asked about — so the row built from CYLS lists CYLS,
-- and the row built from CYYZ lists CYYZ. A plain upsert makes the last one
-- polled the winner, and the NOTAM silently stops being findable everywhere
-- else. For a runway closure that would be a safety bug, not a data bug.
--
-- Postgres cannot express "merge this array" in a plain ON CONFLICT from
-- PostgREST, hence a function. Takes the whole batch as jsonb so a sweep is
-- one round trip rather than one per NOTAM.
create or replace function upsert_notams(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into notams (
    source, notam_id, fir, affected, scope, qcode, category, severity,
    starts_at, ends_at, permanent, estimated, body, raw, last_seen)
  select
    x.source, x.notam_id, x.fir, coalesce(x.affected, '{}'), x.scope, x.qcode,
    x.category, coalesce(x.severity, 'info'), x.starts_at, x.ends_at,
    coalesce(x.permanent, false), coalesce(x.estimated, false),
    x.body, x.raw, coalesce(x.last_seen, now())
  from jsonb_to_recordset(p) as x(
    source text, notam_id text, fir text, affected text[], scope text, qcode text,
    category text, severity text, starts_at timestamptz, ends_at timestamptz,
    permanent boolean, estimated boolean, body text, raw text, last_seen timestamptz)
  on conflict (source, notam_id) do update set
    affected  = (select array_agg(distinct e)
                 from unnest(notams.affected || excluded.affected) e),
    fir       = coalesce(excluded.fir, notams.fir),
    scope     = excluded.scope,
    qcode     = excluded.qcode,
    category  = excluded.category,
    severity  = excluded.severity,
    starts_at = excluded.starts_at,
    ends_at   = excluded.ends_at,
    permanent = excluded.permanent,
    estimated = excluded.estimated,
    body      = excluded.body,
    raw       = excluded.raw,
    last_seen = excluded.last_seen;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Only the worker writes NOTAMs.
revoke all on function upsert_notams(jsonb) from public, anon, authenticated;
grant execute on function upsert_notams(jsonb) to service_role;

-- ── What to poll ─────────────────────────────────────────────────────────
--
-- Push sources (the FAA's SWIM feed) deliver everything and ignore this
-- table. Poll sources cannot: NAV CANADA answers per aerodrome, so something
-- has to decide which of ~1,900 Canadian fields are worth asking about and
-- how often.
--
-- Seeded from actual usage rather than by enumerating every aerodrome. That
-- is cheaper, and it is also the neighbourly thing to do with a public
-- endpoint that nobody is charging us for.

create table if not exists notam_watch (
  ident        text primary key,
  source       text not null,
  -- Higher polls sooner and more often. A field somebody has open right now
  -- matters more than one seen once last month.
  priority     int not null default 0,
  last_polled  timestamptz,
  last_error   text,
  requested_at timestamptz not null default now()
);

create index if not exists notam_watch_due_idx on notam_watch (priority desc, last_polled asc nulls first);

alter table notam_watch enable row level security;
grant select on notam_watch to authenticated;

drop policy if exists "watch list is readable" on notam_watch;
create policy "watch list is readable"
  on notam_watch for select
  using (true);

-- Lets the app say "a pilot is looking at this field" without granting it
-- write access to the table. Security definer so the insert happens with the
-- function owner's rights; the body is the only thing that decides what gets
-- written, and it can only ever bump one ident's priority.
create or replace function request_notam_watch(p_ident text, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ident !~ '^[A-Z0-9]{3,4}$' or p_source not in ('navcanada', 'faa') then
    return;
  end if;
  insert into notam_watch (ident, source, priority)
  values (p_ident, p_source, 1)
  on conflict (ident) do update
    set priority = least(notam_watch.priority + 1, 100),
        requested_at = now();
end;
$$;

revoke all on function request_notam_watch(text, text) from public, anon;
grant execute on function request_notam_watch(text, text) to authenticated;
