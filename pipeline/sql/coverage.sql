-- Per-type coverage of the places catalog: one row per place_type that has rows.
-- Run: psql "$DB_URL" -f pipeline/sql/coverage.sql
-- with_hours counts rows with hours_raw; with_photo counts places with at least one visible
-- (hidden = false) place_photos row; with_vibe_inputs counts places with any place_vibe_inputs row.
with typed as (
  select id, 'restaurants'::text as place_type, address, website, hours_raw from public.restaurants
  union all
  select id, 'museums', address, website, hours_raw from public.museums
  union all
  select id, 'entertainment', address, website, hours_raw from public.entertainment
  union all
  select id, 'parks', address, website, hours_raw from public.parks
  union all
  select id, 'landmarks', address, website, hours_raw from public.landmarks
)
select
  t.place_type,
  count(*) as rows,
  count(*) filter (where t.address is not null) as with_address,
  count(*) filter (where t.website is not null) as with_website,
  count(*) filter (where t.hours_raw is not null) as with_hours,
  count(*) filter (where exists (
    select 1 from public.place_photos pp where pp.place_ref = t.id and not pp.hidden
  )) as with_photo,
  count(*) filter (where exists (
    select 1 from public.place_vibe_inputs pv where pv.place_ref = t.id
  )) as with_vibe_inputs
from typed t
group by t.place_type
order by array_position(
  array['restaurants', 'museums', 'entertainment', 'parks', 'landmarks'], t.place_type);
