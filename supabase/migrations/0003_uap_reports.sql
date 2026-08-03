-- Shared UAP/UFO sighting reports — a real cross-pilot database, not the
-- private per-user blob storage 0001's `backups` table provides. Same
-- conventions as 0001/0002: uuid FKs to auth.users cascade on delete, RLS
-- enabled with an explicit grant before the policy, text + check instead of
-- enums. Two deliberate exceptions to "no triggers, app-maintained values"
-- below (reporter_account_age_days, corroboration matching) — both are
-- called out inline, because the point of both is specifically that the
-- client can't set or spoof them, which an app-maintained value can't give.
--
-- Deliberately append-only from the client: no update/delete grant, no
-- update/delete policy. A "gold standard" dataset can't have quietly
-- rewritten history — a pilot who wants a submission removed contacts
-- support, and it's deleted/anonymized manually via the Supabase dashboard,
-- same operational model as the `reports` table in 0002. Also deliberately
-- no public feed: select is scoped to the reporter's own rows only. Any
-- aggregate use of this table (the actual "dataset") happens via the
-- Supabase dashboard/service tooling, not through app RLS.

create table if not exists uap_reports (
  id                  bigint generated always as identity primary key,
  reporter_id         uuid not null references auth.users(id) on delete cascade,

  -- ── What/when/where ──────────────────────────────────────────────────
  occurred_at         timestamptz not null,
  -- A bucket, not fake-precision seconds — nobody actually times a sighting
  -- to the second, so asking for one just invites a made-up number.
  duration_bucket     text check (duration_bucket in
                         ('under_10s', '10_60s', '1_5min', '5_30min', 'over_30min', 'ongoing')),
  location_text       text not null,
  lat                 double precision,
  lon                 double precision,
  altitude_ft         integer,  -- the reporter's own altitude, if airborne

  shape               text check (shape in
                         ('disc', 'orb_sphere', 'triangle', 'cylinder', 'cigar', 'fireball', 'formation', 'other')),
  motion              text check (motion in
                         ('hovering', 'rapid_acceleration', 'silent_flight', 'erratic',
                          'instant_direction_change', 'standard_flight_path', 'other')),
  angular_size        text check (angular_size in
                         ('smaller_than_star', 'fist_at_arm', 'larger_than_moon', 'larger_than_aircraft', 'unsure')),
  color               text,
  sound               text check (sound in ('silent', 'low_hum', 'roar', 'other')),
  witness_count       integer,
  nearby_objects      text,  -- other aircraft/drones/weather/lights the reporter noted
  weather_visibility  text,
  description         text not null,

  -- ── About the reporter — optional, bucketed, never identity ─────────
  reporter_age_range  text check (reporter_age_range in
                         ('under_18', '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus', 'prefer_not_to_say')),
  reporter_gender     text check (reporter_gender in
                         ('woman', 'man', 'nonbinary', 'self_described', 'prefer_not_to_say')),
  reporter_gender_other text,

  -- ── Credibility signals ───────────────────────────────────────────────
  -- Client-attested, snapshotted at submit time (there's no update policy,
  -- so this is also the only time it CAN be set) — honest framing: this is
  -- self-reported-but-plausible, same trust tier as a certificate number,
  -- not independently verified. reporter_account_age_days below is the one
  -- signal here that actually is non-spoofable.
  reporter_is_pilot     boolean not null default false,
  reporter_logged_hours numeric,
  -- Populated by the trigger below, never accepted from the client.
  reporter_account_age_days integer,

  -- Set only by match_uap_corroboration() below, never by the client.
  corroboration_group_id bigint,

  -- ── Consent ────────────────────────────────────────────────────────────
  -- The row cannot be inserted without explicit true — belt and suspenders
  -- alongside the RLS insert check below. consent_version records which
  -- wording of the disclosure a pilot actually agreed to, so a later copy
  -- change doesn't retroactively blur what earlier rows consented to.
  data_share_consent  boolean not null default false check (data_share_consent),
  consent_version     text not null default 'v1',

  created_at          timestamptz not null default now()
);

create index if not exists uap_reports_reporter_id_idx on uap_reports(reporter_id);
create index if not exists uap_reports_occurred_at_idx on uap_reports(occurred_at);
create index if not exists uap_reports_corroboration_group_id_idx on uap_reports(corroboration_group_id);

alter table uap_reports enable row level security;

grant select, insert on uap_reports to authenticated;

create policy "reporters see their own uap reports"
  on uap_reports for select
  using (auth.uid() = reporter_id);

create policy "reporters submit uap reports with consent"
  on uap_reports for insert
  with check (auth.uid() = reporter_id and data_share_consent);

-- Deliberate exception to "no triggers" (see file header): the entire point
-- of reporter_account_age_days is that a pilot can't inflate it by simply
-- sending a bigger number, so it can't be an app-maintained/client-sent
-- value like everywhere else in this schema. security definer is required
-- because the `authenticated` role has no direct grant on auth.users.
create or replace function set_uap_report_account_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select extract(day from now() - created_at)::integer
    into new.reporter_account_age_days
    from auth.users
    where id = new.reporter_id;
  return new;
end;
$$;

create trigger uap_reports_set_account_age
  before insert on uap_reports
  for each row execute function set_uap_report_account_age();

-- Corroboration matching — the other deliberate exception to "no triggers,
-- app-maintained": this has to update OTHER pilots' rows (their
-- corroboration_group_id), which the submitting pilot's own RLS-scoped
-- session can never do directly. security definer is what makes that
-- possible; the ownership check just below is what stops a pilot from
-- passing an arbitrary report_id to force recomputation on a report that
-- isn't theirs. Called fire-and-forget by the client right after insert,
-- via supabase.rpc(...) — not an automatic trigger, so it stays in the same
-- "explicitly invoked by client code" spirit as the rest of this migration,
-- just needing elevated rights to actually do its job.
create or replace function match_uap_corroboration(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  existing_group bigint;
begin
  select id, reporter_id, occurred_at, lat, lon
    into r
    from uap_reports
    where id = p_report_id;

  if r.reporter_id is distinct from auth.uid() or r.lat is null or r.lon is null then
    return;
  end if;

  -- An existing group id among matches wins, so repeated matches converge
  -- on one group instead of forking a new one every time; a fresh pair with
  -- no prior group starts one, seeded from this report's own id.
  select corroboration_group_id
    into existing_group
    from uap_reports
    where id <> r.id
      and corroboration_group_id is not null
      and abs(extract(epoch from (occurred_at - r.occurred_at))) <= 2700  -- 45 minutes
      and abs(lat - r.lat) <= 0.5
      -- Longitude degrees shrink toward the poles — this correction keeps
      -- the match box roughly uniform distance at any latitude instead of
      -- being much narrower (in km) near the equator than near the poles.
      and abs(lon - r.lon) <= 0.5 / cos(radians(r.lat))
    limit 1;

  update uap_reports
    set corroboration_group_id = coalesce(existing_group, r.id)
    where id = r.id or (
      corroboration_group_id is null
      and abs(extract(epoch from (occurred_at - r.occurred_at))) <= 2700
      and abs(lat - r.lat) <= 0.5
      and abs(lon - r.lon) <= 0.5 / cos(radians(r.lat))
    );
end;
$$;

grant execute on function match_uap_corroboration(bigint) to authenticated;
