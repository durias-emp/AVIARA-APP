-- Backup & restore storage: one row per pilot per local IndexedDB store name.
-- Not a relational mirror of each store's shape — a JSONB blob per store
-- keeps the sync code generic (same push/pull function works for every
-- store name: aircraft, currency, checklists, settings, flights).
create table if not exists backups (
  -- on delete cascade: removing a user (e.g. account deletion in the
  -- dashboard) also removes their backup rows, rather than the FK blocking
  -- the delete.
  user_id uuid references auth.users(id) on delete cascade not null,
  store_name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store_name)
);

alter table backups enable row level security;

-- RLS policies restrict access per-row, but PostgREST also requires the
-- base table-level grant before it'll even attempt a query — without this,
-- every request fails with "permission denied for table backups" before RLS
-- is ever evaluated. ("Automatically expose new tables" in project settings
-- would have done this for us; we turned that off for manual control.)
grant select, insert, update, delete on backups to authenticated;

create policy "users manage their own backups"
  on backups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Minimal usage analytics: what pilots do, not a full analytics platform.
create table if not exists events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

-- Insert-only grant to match the insert-only policy below — no select
-- grant, so this table can't be read back from the client even if a select
-- policy were added later by mistake.
grant insert on events to authenticated;

-- Insert-only from the client — no select policy for end users. Reading
-- back is done via the Supabase dashboard/SQL editor as the app owner.
create policy "users insert their own events"
  on events for insert
  with check (auth.uid() = user_id);
