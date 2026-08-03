-- Room for a real aircraft spec sheet on a listing.
--
-- 0002 gave listings the fields a card needs — make, model, year, times,
-- price, location. What a buyer actually decides on is the next layer down:
-- what's in the panel, when the engine was last opened, what the useful load
-- is, whether it's ever been damaged. That list is long, varies by aircraft
-- type, and will keep growing, so it goes in jsonb rather than becoming forty
-- mostly-null columns.
--
-- Two exceptions get real columns, because they are filtered on rather than
-- read: engine type and the sale currency.
--
-- Additive and idempotent — the shared live project already has listings.

-- Piston / turboprop / jet is the first cut every buyer makes, and
-- MarketplaceTab has had those exact filter chips sitting there inert since
-- it was built. A jsonb key can't be indexed as cheaply or filtered as
-- clearly, so this is a column.
alter table listings add column if not exists engine_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_engine_type_check'
  ) then
    alter table listings add constraint listings_engine_type_check
      check (engine_type is null or engine_type in ('piston', 'turboprop', 'jet', 'other'));
  end if;
end $$;

create index if not exists listings_engine_type_idx on listings(engine_type);
create index if not exists listings_price_idx on listings(price_usd);

-- The column is price_usd and the aircraft market quotes in USD almost
-- everywhere, including Canada — but a seller listing a Cub locally may well
-- want CAD, and silently relabelling their number would be the worst kind of
-- wrong. So the currency travels with the price and the UI always prints it.
alter table listings add column if not exists currency text not null default 'USD';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_currency_check'
  ) then
    alter table listings add constraint listings_currency_check
      check (currency in ('USD', 'CAD', 'EUR', 'GBP'));
  end if;
end $$;

-- Everything else. Free-form by design: a Cessna 172 listing and a King Air
-- listing do not describe themselves with the same fields, and forcing both
-- into one column set would mean most of it empty for both.
--
-- The app writes a known set of keys (see SPEC_FIELDS in
-- src/pages/Discover/ListingForm.jsx) so listings stay comparable; jsonb is
-- what keeps adding the next one a UI change rather than a migration against
-- a live database.
alter table listings add column if not exists specs jsonb not null default '{}'::jsonb;

comment on column listings.specs is
  'Extended spec sheet: avionics, engine/prop times, weights, capacities, '
  'condition. Written by the listing form against a known key set; jsonb so '
  'new fields do not need a migration.';
