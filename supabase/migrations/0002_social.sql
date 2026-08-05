-- Social profile (posts, follows, DMs) and aircraft marketplace.
--
-- Same conventions as 0001_backups_and_events.sql: uuid FKs to auth.users
-- cascade on delete, RLS enabled on every table with an explicit grant
-- before the policy (PostgREST 403s on the missing grant before RLS is
-- ever evaluated — see that file's comment), and derived/normalized values
-- (an ordering, a timestamp, a status) are computed by the app rather than
-- by a trigger. No triggers anywhere in this migration, on purpose, to
-- keep the actual data flow readable from the client code, not hidden in
-- the database.
--
-- Table order matters here (a table can't reference one that doesn't exist
-- yet): Identity -> Social graph -> Trust & safety -> Posts -> Marketplace
-- -> Direct messages, since conversations.listing_id points at listings.

-- ── Identity ──────────────────────────────────────────────────────────────

-- One row per auth user, created by the app right after sign-up. Deliberately
-- thin: certificate number, home airport etc. stay in the private local
-- pilot profile (IndexedDB) and are never auto-copied here — home airport in
-- particular is "where my plane lives," and defaulting that to public on a
-- feature adjacent to a marketplace is a real theft-risk footgun. Anything
-- aviation-specific shown publicly should be an explicit opt-in later, not
-- a default.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  -- Lowercase + charset enforced in the constraint, not just the app, so a
  -- bad row can't sneak in from anywhere (dashboard, a future script).
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url   text,
  bio          text,
  -- Governs post visibility only (see can_view_posts below) — profile
  -- identity (username/avatar/bio) stays visible either way, same as
  -- Instagram shows a private account's picture and bio, just not its
  -- posts. No approve/reject UI exists yet; this only makes flipping it on
  -- later a settings change instead of a migration.
  is_private   boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

-- Public identity — grant to anon too: a pilot who's just opened the app
-- (no account yet) can still see who's on it, which is the point of a
-- "suggested pilots to follow" moment on new-user onboarding.
grant select on profiles to anon, authenticated;
grant insert, update on profiles to authenticated;

create policy "profiles are publicly visible"
  on profiles for select
  using (true);

create policy "users manage their own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "users update their own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── Social graph ──────────────────────────────────────────────────────────

-- status: 'accepted' immediately for a public target profile, 'pending'
-- for a private one until the target approves it — the app reads the
-- target's is_private before insert and sets status accordingly (same
-- trust boundary as conversations.user_a/user_b ordering below: the app
-- is expected to get this right, RLS only constrains who's allowed to
-- touch which rows, not what value they choose within that).
create table if not exists follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Reverse-direction lookups ("who follows me") aren't covered by the
-- (follower_id, followee_id) primary key's leading column.
create index if not exists follows_followee_id_idx on follows(followee_id);

alter table follows enable row level security;

grant select on follows to anon, authenticated;
grant insert, update, delete on follows to authenticated;

create policy "follow relationships are publicly visible"
  on follows for select
  using (true);

create policy "users follow as themselves"
  on follows for insert
  with check (auth.uid() = follower_id);

-- Only the target can flip pending -> accepted (approve a follow request
-- on a private profile). The app is trusted not to let a follower edit
-- their own row into 'accepted' — RLS here only checks *whose* row it is,
-- same trust boundary noted above.
create policy "targets approve their own follow requests"
  on follows for update
  using (auth.uid() = followee_id)
  with check (auth.uid() = followee_id);

-- Either side can end a follow: the follower unfollowing, or the followee
-- removing a follower.
create policy "either side can remove a follow"
  on follows for delete
  using (auth.uid() = follower_id or auth.uid() = followee_id);

-- ── Trust & safety ───────────────────────────────────────────────────────
-- Defined before posts/DMs since both reference it. Ships with this
-- migration, not deferred to later polish — DMs plus a marketplace with
-- strangers messaging about money is exactly the profile that attracts
-- abuse.

create table if not exists blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_id_idx on blocks(blocked_id);

alter table blocks enable row level security;

grant select, insert, delete on blocks to authenticated;

-- Scoped to blocker_id only, deliberately — the blocked person finding out
-- they've been blocked defeats the point.
create policy "users manage their own block list"
  on blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- Insert-only from the client, same shape as the events table in
-- 0001 — no select grant, so reports can't be read back even by the
-- reporter. Reviewed from the Supabase dashboard as the app owner.
--
-- subject_id is plain text with no FK, on purpose: a report can point at a
-- post (bigint id), a profile (uuid), a message (bigint), or a listing
-- (bigint) — four different id types and tables. A real per-type FK would
-- need four nullable columns or a validating trigger for a table nothing
-- but a human ever reads; not worth it for that.
create table if not exists reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  subject_type text not null check (subject_type in ('post', 'comment', 'message', 'listing', 'profile')),
  subject_id   text not null,
  reason       text,
  created_at   timestamptz not null default now()
);

alter table reports enable row level security;

grant insert on reports to authenticated;

create policy "users file their own reports"
  on reports for insert
  with check (auth.uid() = reporter_id);

-- ── Posts ─────────────────────────────────────────────────────────────────

-- Shared visibility check for posts/post_media/post_likes/comments: can
-- `viewer` see things authored by `author`? True for the author themself,
-- for anyone if the author's profile isn't private, or for an accepted
-- follower of a private author. `viewer` is null for an anonymous
-- (anon-role) request — every branch below correctly evaluates to false
-- for a null viewer except the "not private" one, so an anonymous visitor
-- sees exactly the public posts and nothing else.
create or replace function can_view_posts(viewer uuid, author uuid)
returns boolean
language sql
stable
as $$
  select
    author = viewer
    or exists (select 1 from profiles p where p.id = author and p.is_private = false)
    or exists (
      select 1 from follows f
      where f.follower_id = viewer and f.followee_id = author and f.status = 'accepted'
    )
$$;

grant execute on function can_view_posts(uuid, uuid) to anon, authenticated;

create table if not exists posts (
  id         bigint generated always as identity primary key,
  author_id  uuid not null references auth.users(id) on delete cascade,
  caption    text,
  created_at timestamptz not null default now()
);

create index if not exists posts_author_id_created_at_idx on posts(author_id, created_at desc);

alter table posts enable row level security;

grant select on posts to anon, authenticated;
grant insert, update, delete on posts to authenticated;

create policy "posts visible per can_view_posts"
  on posts for select
  using (can_view_posts(auth.uid(), author_id));

create policy "users author their own posts"
  on posts for insert
  with check (auth.uid() = author_id);

create policy "users edit their own posts"
  on posts for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create policy "users delete their own posts"
  on posts for delete
  using (auth.uid() = author_id);

create table if not exists post_media (
  id       bigint generated always as identity primary key,
  post_id  bigint not null references posts(id) on delete cascade,
  url      text not null,
  position int not null default 0
);

create index if not exists post_media_post_id_idx on post_media(post_id);

alter table post_media enable row level security;

grant select on post_media to anon, authenticated;
grant insert, delete on post_media to authenticated;

create policy "post media visible with its post"
  on post_media for select
  using (can_view_posts(auth.uid(), (select author_id from posts where id = post_id)));

create policy "post authors attach their own media"
  on post_media for insert
  with check (auth.uid() = (select author_id from posts where id = post_id));

create policy "post authors remove their own media"
  on post_media for delete
  using (auth.uid() = (select author_id from posts where id = post_id));

create table if not exists post_likes (
  post_id    bigint not null references posts(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table post_likes enable row level security;

grant select, insert, delete on post_likes to authenticated;

create policy "likes visible with their post"
  on post_likes for select
  using (can_view_posts(auth.uid(), (select author_id from posts where id = post_id)));

create policy "users like posts they can see, as themselves"
  on post_likes for insert
  with check (
    auth.uid() = user_id
    and can_view_posts(auth.uid(), (select author_id from posts where id = post_id))
  );

create policy "users remove their own likes"
  on post_likes for delete
  using (auth.uid() = user_id);

create table if not exists comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references posts(id) on delete cascade,
  author_id  uuid   not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on comments(post_id);

alter table comments enable row level security;

grant select, insert, delete on comments to authenticated;

create policy "comments visible with their post"
  on comments for select
  using (can_view_posts(auth.uid(), (select author_id from posts where id = post_id)));

create policy "users comment on posts they can see, as themselves"
  on comments for insert
  with check (
    auth.uid() = author_id
    and can_view_posts(auth.uid(), (select author_id from posts where id = post_id))
  );

-- Either the commenter or the post's own author can remove a comment — a
-- pilot can moderate abusive replies on their own post, same as Instagram.
create policy "comment author or post author can delete"
  on comments for delete
  using (
    auth.uid() = author_id
    or auth.uid() = (select author_id from posts where id = post_id)
  );

-- ── Marketplace ───────────────────────────────────────────────────────────
-- Fields are copied in at listing-creation time (from a Hangar aircraft, or
-- typed by hand for a standalone listing) rather than referencing a live
-- aircraft record — there isn't one to reference. A pilot's aircraft today
-- lives only as an opaque JSONB blob inside `backups` (see 0001), not a
-- queryable Postgres row, so no FK is possible. This is also just correct
-- behavior for a listing regardless: a buyer should see what was true when
-- listed, not have it silently drift if the seller edits their Hangar entry
-- afterward. Defined before Direct messages below, since a conversation can
-- optionally point at the listing it started from.

create table if not exists listings (
  id                 bigint generated always as identity primary key,
  seller_id          uuid not null references auth.users(id) on delete cascade,
  make               text,
  model              text,
  year               int,
  registration       text,     -- optional; seller's call whether to disclose
  total_time_hours   numeric,
  engine_time_hours  numeric,
  price_usd          numeric,
  location           text,     -- free text; seller's call on precision
  description        text,
  status             text not null default 'active'
                        check (status in ('active', 'pending', 'sold', 'withdrawn')),
  created_at         timestamptz not null default now(),
  -- App-maintained on every edit — no trigger, same convention as
  -- conversations.last_message_at below.
  updated_at         timestamptz not null default now()
);

create index if not exists listings_status_idx on listings(status);

alter table listings enable row level security;

-- Public browsing, matching listing_media's grant below — a listing is
-- only useful if as many potential buyers as possible can find it,
-- account or not.
grant select on listings to anon, authenticated;
grant insert, update, delete on listings to authenticated;

create policy "listings are publicly visible"
  on listings for select
  using (true);

create policy "sellers manage their own listings"
  on listings for all
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

create table if not exists listing_media (
  id          bigint generated always as identity primary key,
  listing_id  bigint not null references listings(id) on delete cascade,
  url         text not null,
  position    int not null default 0
);

create index if not exists listing_media_listing_id_idx on listing_media(listing_id);

alter table listing_media enable row level security;

grant select on listing_media to anon, authenticated;
grant insert, delete on listing_media to authenticated;

create policy "listing media is publicly visible"
  on listing_media for select
  using (true);

create policy "sellers manage their own listing media"
  on listing_media for all
  using (auth.uid() = (select seller_id from listings where id = listing_id))
  with check (auth.uid() = (select seller_id from listings where id = listing_id));

-- ── Direct messages ──────────────────────────────────────────────────────
-- 1:1 only — group DMs are an explicitly later phase, not this one.

create table if not exists conversations (
  id               bigint generated always as identity primary key,
  -- The app always inserts the lexicographically smaller uuid as user_a —
  -- the check (not a trigger) just rejects it if that didn't happen,
  -- rather than silently normalizing. That's what stops A-starts-a-thread
  -- and B-starts-a-thread from ever becoming two separate rows.
  user_a           uuid not null references auth.users(id) on delete cascade,
  user_b           uuid not null references auth.users(id) on delete cascade,
  -- Which listing (if any) this conversation started from — context for
  -- the "Inquire" button on a marketplace listing. Nullable: most
  -- conversations aren't about a listing, and once a thread exists between
  -- two people every DM between them stays in it regardless of topic,
  -- same as any other DM product.
  listing_id       bigint references listings(id) on delete set null,
  created_at       timestamptz not null default now(),
  -- App-maintained on every new message — see messages below. No trigger.
  last_message_at  timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);

alter table conversations enable row level security;

grant select, insert, update on conversations to authenticated;

create policy "users see their own conversations"
  on conversations for select
  using (auth.uid() in (user_a, user_b));

-- Blocks conversation creation between a blocked pair in either direction.
-- (An already-existing conversation between two people who later block
-- each other is still stopped — see the messages insert policy below,
-- which re-checks this on every message, not just at creation.)
create policy "conversations only start between non-blocked pairs"
  on conversations for insert
  with check (
    auth.uid() in (user_a, user_b)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = user_a and b.blocked_id = user_b)
         or (b.blocker_id = user_b and b.blocked_id = user_a)
    )
  );

-- For last_message_at maintenance only — the app is trusted to set just
-- that column, not rewrite the conversation's participants.
create policy "participants update their own conversation metadata"
  on conversations for update
  using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b));

create table if not exists messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now(),
  -- Set by the recipient when read. The app is trusted to only ever touch
  -- this column on update, not sender_id/body — same trust boundary as
  -- elsewhere in this migration, not enforced at column level.
  read_at         timestamptz
);

create index if not exists messages_conversation_id_created_at_idx on messages(conversation_id, created_at);

alter table messages enable row level security;

grant select, insert, update on messages to authenticated;

create policy "users read messages in their own conversations"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  );

create policy "users send messages in their own, non-blocked conversations"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and auth.uid() in (c.user_a, c.user_b)
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = c.user_a and b.blocked_id = c.user_b)
             or (b.blocker_id = c.user_b and b.blocked_id = c.user_a)
        )
    )
  );

create policy "recipients mark messages as read"
  on messages for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  )
  with check (sender_id <> auth.uid());
