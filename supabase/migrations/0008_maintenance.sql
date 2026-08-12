-- Aircraft maintenance tracking, ported from Diego's CNA OpsBoard system.
--
-- Two deliberate departures from the package as shipped:
--
-- 1. No `aircraft` table. AVIARA keeps aircraft profiles in IndexedDB on the
--    device, so `aircraft_id` here is that local record's uuid and carries no
--    foreign key. The live counters the status engine needs — airframe hours
--    and cycles — come from the local profile at render time. This avoids
--    inventing a local-to-cloud aircraft sync just to hang maintenance off.
--
-- 2. Row-level security, which the package has none of. Maintenance history is
--    per-owner: without policies every signed-in pilot could read and rewrite
--    every other aircraft's inspection record. Owner-scoped for now — letting
--    a mechanic see one aircraft is a real feature but needs its own design,
--    and guessing at it here would be the wrong kind of open.

create table if not exists maintenance_items (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null references auth.users(id) on delete cascade,
  aircraft_id              uuid not null,          -- local IndexedDB aircraft record
  item_number              text,                   -- sheet reference, e.g. "B-10"
  description              text not null,
  category                 text,                   -- 'periodic' | 'airframe' | 'engine'
  is_active                boolean default true,
  limit_type               text,                   -- null | 'ON_CONDITION' | 'HOURS' | 'DATE_OR_HOURS' | 'HOURS_AND_CYCLES'

  -- The three clocks, stored as absolute values rather than countdowns so
  -- that flying the aircraft never has to touch this table.
  due_at_hours             numeric,
  due_at_cycles            integer,
  due_date                 date,

  -- Intervals, used to roll the clocks forward when compliance is logged
  hours_interval           numeric,
  calendar_interval_months integer,
  cycles_interval          integer,

  last_complied_date       date,
  last_complied_hours      numeric,
  last_complied_cycles     integer,

  reference                text,
  part_number              text,
  serial_number            text,
  event_type               text,
  source_ref               text,
  notes                    text,                   -- 'N/A …' and 'TRACK:ac:oh' prefixes are read by the status engine
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- Immutable audit trail. One row per compliance event: never updated, never
-- deleted. An inspection record whose history can be edited is not a record.
create table if not exists maintenance_compliance_log (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  maintenance_item_id uuid not null references maintenance_items(id) on delete cascade,
  aircraft_id         uuid not null,
  work_order_number   text not null,
  complied_date       date not null,
  complied_hours      numeric not null,
  complied_cycles     integer,
  notes               text,
  created_at          timestamptz default now()
);

create index if not exists maintenance_items_aircraft_idx
  on maintenance_items(aircraft_id) where is_active;
create index if not exists maintenance_compliance_item_idx
  on maintenance_compliance_log(maintenance_item_id, complied_date desc);

-- ── Row-level security ──────────────────────────────────────────────
-- Same PostgREST reality as pireps: the base grant must exist or every
-- request 403s before RLS is ever consulted.

alter table maintenance_items enable row level security;
alter table maintenance_compliance_log enable row level security;

grant select, insert, update, delete on maintenance_items to authenticated;
grant select, insert on maintenance_compliance_log to authenticated;

create policy "owners read their maintenance items"
  on maintenance_items for select to authenticated using (auth.uid() = owner_id);
create policy "owners create their maintenance items"
  on maintenance_items for insert to authenticated with check (auth.uid() = owner_id);
create policy "owners update their maintenance items"
  on maintenance_items for update to authenticated using (auth.uid() = owner_id);
create policy "owners delete their maintenance items"
  on maintenance_items for delete to authenticated using (auth.uid() = owner_id);

create policy "owners read their compliance log"
  on maintenance_compliance_log for select to authenticated using (auth.uid() = owner_id);
create policy "owners append to their compliance log"
  on maintenance_compliance_log for insert to authenticated with check (auth.uid() = owner_id);
-- No update or delete policy, and no grant for them. The audit trail is
-- append-only at the database level, not merely by convention in the UI.

-- ── Atomic compliance ───────────────────────────────────────────────
-- Logging compliance is two writes: append the audit row, roll the clocks
-- forward. As separate client calls a dropped connection between them leaves
-- an item whose due values moved with no record of why, or a record with no
-- movement. One transaction, and the row is locked against a second mechanic
-- submitting the same item at the same moment.
--
-- Left as SECURITY INVOKER so the policies above still apply: the function
-- cannot be used to write to an item the caller does not own.

create or replace function log_compliance(
  p_item_id         uuid,
  p_work_order      text,
  p_complied_date   date,
  p_complied_hours  numeric,
  p_complied_cycles integer default null,
  p_notes           text    default null
) returns void
language plpgsql
as $$
declare
  v_item maintenance_items%rowtype;
begin
  -- RLS applies to this select, so an item belonging to someone else simply
  -- is not found — the caller learns nothing about whether it exists.
  select * into v_item from maintenance_items where id = p_item_id for update;
  if not found then
    raise exception 'Maintenance item % not found', p_item_id;
  end if;

  insert into maintenance_compliance_log
    (owner_id, maintenance_item_id, aircraft_id, work_order_number,
     complied_date, complied_hours, complied_cycles, notes)
  values
    (v_item.owner_id, p_item_id, v_item.aircraft_id, p_work_order,
     p_complied_date, p_complied_hours, p_complied_cycles, p_notes);

  update maintenance_items set
    last_complied_date   = p_complied_date,
    last_complied_hours  = p_complied_hours,
    last_complied_cycles = p_complied_cycles,
    due_date = case
      when calendar_interval_months is not null
      then (p_complied_date + (calendar_interval_months * interval '1 month'))::date
      else due_date end,
    due_at_hours = case
      when hours_interval is not null
      then round(p_complied_hours + hours_interval, 1)
      else due_at_hours end,
    due_at_cycles = case
      when cycles_interval is not null and p_complied_cycles is not null
      then p_complied_cycles + cycles_interval
      else due_at_cycles end,
    updated_at = now()
  where id = p_item_id;
end;
$$;
