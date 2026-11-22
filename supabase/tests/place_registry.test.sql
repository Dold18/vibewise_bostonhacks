-- Place registry (docs/superpowers/specs/2026-11-21-non-food-places-design.md §5).
-- Runs against the local stack after `supabase db reset` (needs supabase/seed.sql).
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- Schema shape.
select has_table('public', 'places', 'places registry exists');
select has_table('public', 'museums', 'museums table exists');
select has_table('public', 'parks', 'parks table exists');
select has_table('public', 'landmarks', 'landmarks table exists');
select has_table('public', 'entertainment', 'entertainment table exists');
select has_view('public', 'place_points', 'place_points view exists');
select has_view('public', 'catalog_places', 'catalog_places view exists');
select hasnt_view('public', 'restaurant_points', 'restaurant_points view is dropped');

select has_column('public', 'student_reviews', 'place_ref', 'student_reviews.place_ref exists');
select hasnt_column('public', 'student_reviews', 'restaurant_id', 'student_reviews.restaurant_id is gone');
select has_column('public', 'place_photos', 'place_ref', 'place_photos.place_ref exists');
select hasnt_column('public', 'place_photos', 'restaurant_id', 'place_photos.restaurant_id is gone');
select has_column('public', 'place_vibe_inputs', 'place_ref', 'place_vibe_inputs.place_ref exists');
select hasnt_column('public', 'place_vibe_inputs', 'restaurant_id', 'place_vibe_inputs.restaurant_id is gone');
select has_column('public', 'place_deals', 'place_ref', 'place_deals.place_ref exists');
select hasnt_column('public', 'place_deals', 'restaurant_id', 'place_deals.restaurant_id is gone');

-- Sync triggers on every type table.
select has_trigger('public', t, 'places_sync_delete', t || ' has the delete sync trigger')
from unnest(array['restaurants', 'museums', 'parks', 'landmarks', 'entertainment']) as t;
select has_trigger('public', t, 'places_sync_place_id', t || ' has the place_id sync trigger')
from unnest(array['restaurants', 'museums', 'parks', 'landmarks', 'entertainment']) as t;

-- Seeded cafe sits on the registry with the same id.
select is(
  (select place_type from public.places where place_id = 'osm:node/990000001'),
  'restaurants',
  'seeded cafe is registered as a restaurant');
select is(
  (select p.id from public.places p where p.place_id = 'osm:node/990000001'),
  (select r.id from public.restaurants r where r.place_id = 'osm:node/990000001'),
  'seeded cafe has the same id in places and restaurants');
select is(
  (select count(*)::int from public.place_deals
   where place_ref = (select id from public.places where place_id = 'osm:node/990000001')),
  2,
  'both seeded deals reference the cafe by place_ref');

-- A new registry row gets an id past every restaurant id.
insert into public.places (place_id, place_type) values ('test:museum/1', 'museums');
select ok(
  (select id from public.places where place_id = 'test:museum/1')
    > (select coalesce(max(id), 0) from public.restaurants),
  'new places id is greater than every restaurant id');

-- Deleting a type row removes its registry row and, by cascade, its shared rows.
insert into public.museums (id, place_id, source, source_id, name, location, kind, attribution)
select id, place_id, 'osm', 'node/test-museum-1', 'TEST Museum',
       extensions.st_setsrid(extensions.st_makepoint(-71.09, 42.34), 4326)::extensions.geography,
       'museum', 'Local test data'
from public.places where place_id = 'test:museum/1';
insert into public.place_photos (place_ref, kind, source, match_method, url, rank)
select id, 'licensed', 'commons', 'wikidata', 'https://example.com/test-museum.jpg', 1
from public.places where place_id = 'test:museum/1';

create temp table museum_ref on commit drop as
  select id from public.places where place_id = 'test:museum/1';

select is(
  (select count(*)::int from public.catalog_places where place_type = 'museums' and id = (select id from museum_ref)),
  1,
  'museum row appears in catalog_places');

delete from public.museums where id = (select id from museum_ref);
select is(
  (select count(*)::int from public.places where id = (select id from museum_ref)),
  0,
  'deleting a museums row deletes its places row');
select is(
  (select count(*)::int from public.place_photos where place_ref = (select id from museum_ref)),
  0,
  'deleting a museums row cascades to its photos');

-- Deleting through the registry cascades to the type row (the trigger's own delete is a no-op).
insert into public.places (place_id, place_type) values ('test:park/1', 'parks');
insert into public.parks (id, place_id, source, source_id, name, location, kind, attribution)
select id, place_id, 'osm', 'way/test-park-1', 'TEST Park',
       extensions.st_setsrid(extensions.st_makepoint(-71.08, 42.35), 4326)::extensions.geography,
       'park', 'Local test data'
from public.places where place_id = 'test:park/1';
select lives_ok(
  $$delete from public.places where place_id = 'test:park/1'$$,
  'deleting a places row with a type row succeeds');
select is(
  (select count(*)::int from public.parks where place_id = 'test:park/1'),
  0,
  'deleting a places row cascades to its parks row');

-- Rekeying a type row copies the new place_id to the registry.
update public.restaurants set place_id = 'osm:node/990000002' where place_id = 'osm:node/990000001';
select is(
  (select p.place_id from public.places p
   join public.restaurants r on r.id = p.id
   where r.place_id = 'osm:node/990000002'),
  'osm:node/990000002',
  'updating restaurants.place_id updates places.place_id');

-- Every restaurant is in the catalog.
select is(
  (select count(*) from public.catalog_places where place_type = 'restaurants'),
  (select count(*) from public.restaurants),
  'catalog_places lists every restaurant');

-- The student review column grant followed the rename.
insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-0000000000aa', 'place-registry-test@example.com', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated"}';
select lives_ok(
  $$insert into public.student_reviews (place_ref, rating, body, vibe_tags)
    values ((select id from public.places where place_id = 'osm:node/990000002'), 5, 'TEST review', '{cozy}')$$,
  'authenticated user can add a review by place_ref');
reset role;

select * from finish();
rollback;
