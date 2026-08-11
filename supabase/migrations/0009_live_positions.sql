-- Where your friends are flying, right now.
--
-- NOT APPLIED. Written for review. Applying it changes the production database
-- for both developers and every real user, so it waits for a human.
--
-- This is the most sensitive row in the schema. Everything else here is a
-- document a pilot chose to write; this is their physical location, updated
-- every few seconds, while they are away from home. The design below is
-- shaped by that rather than by what would be convenient to query.

-- One row per pilot, overwritten in place rather than appended to. A history of
-- everywhere a pilot has been is a different feature with a different consent
-- conversation, and this table must not quietly become one: the flight track
-- the pilot deliberately records already lives in `flights`.
create table if not exists live_positions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  lat          double precision not null,
  lon          double precision not null,
  -- Altitude and track are what make the marker readable as an aircraft in
  -- flight rather than a dot. Nullable because a fix can legitimately carry
  -- neither.
  alt_ft       integer,
  track_deg    integer,
  ground_kt    integer,
  updated_at   timestamptz not null default now()
);

alter table live_positions enable row level security;

-- How long a position keeps meaning "flying now". A fix that stopped arriving
-- is a pilot who landed, closed the app, or lost signal, and none of those
-- should leave a marker sitting on the map implying otherwise.
create or replace function live_position_is_fresh(ts timestamptz)
returns boolean
language sql
immutable
as $$
  select ts > now() - interval '10 minutes'
$$;

grant execute on function live_position_is_fresh(timestamptz) to authenticated;

-- Who may see a live position.
--
-- MUTUAL follows only, deliberately, and not the one-way rule that governs
-- posts. can_view_posts lets anyone see a public account's posts, which is
-- right for something published and wrong for a location: it would let a
-- stranger follow a public pilot and watch where they fly. Both directions
-- having accepted is the closest thing the schema has to "these two people
-- know each other".
--
-- A block on either side ends it regardless of the follows, which is why this
-- cannot be expressed as a plain join.
create or replace function can_view_live_position(viewer uuid, subject uuid)
returns boolean
language sql
stable
as $$
  select
    subject = viewer
    or (
      exists (
        select 1 from follows f
        where f.follower_id = viewer and f.followee_id = subject and f.status = 'accepted'
      )
      and exists (
        select 1 from follows f
        where f.follower_id = subject and f.followee_id = viewer and f.status = 'accepted'
      )
      and not exists (
        select 1 from blocks b
        where (b.blocker_id = subject and b.blocked_id = viewer)
           or (b.blocker_id = viewer and b.blocked_id = subject)
      )
    )
$$;

grant execute on function can_view_live_position(uuid, uuid) to authenticated;

-- Never granted to anon. An unauthenticated reader has no mutual follow with
-- anyone and so could never pass the check, but the grant is withheld rather
-- than relied upon to fail.
create policy "live positions visible to mutual follows"
  on live_positions for select
  to authenticated
  using (
    can_view_live_position(auth.uid(), user_id)
    and live_position_is_fresh(updated_at)
  );

-- A pilot writes their own position and nobody else's.
create policy "pilots publish their own position"
  on live_positions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "pilots update their own position"
  on live_positions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Switching sharing off deletes the row rather than letting it age out. Ten
-- minutes of still being visible after a pilot says stop is not stopping.
create policy "pilots withdraw their own position"
  on live_positions for delete
  to authenticated
  using (user_id = auth.uid());

-- "Who is up right now" reads by recency across a handful of friends.
create index if not exists live_positions_updated_at_idx on live_positions(updated_at);
