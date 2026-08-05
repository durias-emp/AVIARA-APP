-- Photo storage, and stories.
--
-- 0002 created posts/post_media/listings/listing_media with `url` columns and
-- nothing to put in them: there was no bucket, so nothing could hold a photo.
-- This adds the bucket those columns were always waiting for, plus the one
-- table 0002 didn't anticipate.
--
-- Additive and idempotent throughout — it runs against the shared live
-- project both partners and real users are on, so re-running it must be a
-- no-op rather than a surprise.

-- ── Media bucket ─────────────────────────────────────────────────────────
--
-- Public, deliberately. Listings are already `using (true)` on select in
-- 0002 — a marketplace nobody can browse without an account is not a
-- marketplace — and serving those images through signed URLs would mean a
-- signing round-trip per photo per view for content that is public anyway.
--
-- The cost of that choice, stated plainly because it is a real one: a post
-- image is unguessable, not access-controlled. Object names carry a random
-- uuid, so nobody enumerates them, but if the exact URL were shared it would
-- open regardless of whether the post's author is private. Post *rows* are
-- still governed by can_view_posts; it is only the image bytes that aren't.
-- Moving personal media to a private bucket later is a bucket change plus a
-- signed-URL helper, not a schema change.
insert into storage.buckets (id, name, public)
values ('aviara-media', 'aviara-media', true)
on conflict (id) do nothing;

-- Object names are '<kind>/<user-uuid>/<random>.jpg', so element 2 of the
-- folder path is the owner. That is what makes "write only your own media"
-- expressible without a second table tracking ownership.
drop policy if exists "aviara media is publicly readable" on storage.objects;
create policy "aviara media is publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'aviara-media');

drop policy if exists "users upload into their own media folder" on storage.objects;
create policy "users upload into their own media folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'aviara-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "users replace their own media" on storage.objects;
create policy "users replace their own media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'aviara-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "users delete their own media" on storage.objects;
create policy "users delete their own media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'aviara-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ── Stories ──────────────────────────────────────────────────────────────
--
-- Separate from posts rather than a flag on them. A story has a different
-- lifetime, a different surface, and no comments or likes; folding it into
-- posts would mean every existing posts query growing a "and not a story"
-- clause, which is exactly the kind of condition that gets forgotten once.

create table if not exists stories (
  id         bigint generated always as identity primary key,
  author_id  uuid not null references auth.users(id) on delete cascade,
  url        text not null,
  -- The storage object path alongside the public URL. Deriving one from the
  -- other is possible but brittle, and expiry means these rows are the one
  -- kind this app actively deletes — the cleanup needs to know exactly which
  -- object to remove with them.
  path       text,
  caption    text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists stories_author_id_expires_at_idx
  on stories(author_id, expires_at desc);
create index if not exists stories_expires_at_idx on stories(expires_at);

alter table stories enable row level security;

grant select on stories to anon, authenticated;
grant insert, delete on stories to authenticated;

-- Expiry is enforced here, not in the client. A story is invisible the
-- moment it lapses regardless of what queried it, so a stale page or a
-- hand-written request cannot surface one — the deletion below is only
-- housekeeping, never the thing that makes it private.
--
-- Visibility otherwise follows posts exactly, via the same can_view_posts
-- from 0002, so a private account's stories are as private as its posts.
drop policy if exists "unexpired stories visible per can_view_posts" on stories;
create policy "unexpired stories visible per can_view_posts"
  on stories for select
  using (expires_at > now() and can_view_posts(auth.uid(), author_id));

drop policy if exists "users author their own stories" on stories;
create policy "users author their own stories"
  on stories for insert
  with check (auth.uid() = author_id);

drop policy if exists "users delete their own stories" on stories;
create policy "users delete their own stories"
  on stories for delete
  using (auth.uid() = author_id);

-- Rows outlive their visibility until something removes them, and pg_cron
-- isn't enabled here, so each pilot clears their own the next time they open
-- Discover.
--
-- This has to be a function rather than a client-side delete, for a reason
-- that is easy to miss: the select policy above hides expired rows from
-- *everyone*, their author included. So the app cannot read back the storage
-- paths it needs in order to delete the photos — a plain delete would clear
-- the table and orphan the bytes forever. Running as security definer sees
-- past the policy, and RETURNING hands the paths out so the client can
-- finish the job in storage.
--
-- Scoped to auth.uid() inside the function, never to a caller-supplied id:
-- security definer means this runs with the owner's rights, so the where
-- clause is the only thing standing between it and everyone else's rows.
create or replace function purge_my_expired_stories()
returns table (path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  delete from stories s
   where s.author_id = auth.uid()
     and s.expires_at < now()
  returning s.path;
end;
$$;

revoke all on function purge_my_expired_stories() from public, anon;
grant execute on function purge_my_expired_stories() to authenticated;
