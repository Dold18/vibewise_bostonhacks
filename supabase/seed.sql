-- Local development seed data. Runs on `supabase db reset` only; never on production.
-- Demo places/reviews for the data model in docs/DATA_MODEL.md go here once the
-- schema migration exists.

-- LOCAL TEST DATA ONLY (never real). A fake restaurant near Kenmore with two fake deals,
-- for checking deal chips on pins and the Deals section on the card.
with cafe as (
  insert into restaurants (place_id, source, source_id, name, location, category, attribution)
  values ('osm:node/990000001', 'osm', 'node/990000001', 'TEST ONLY — Deal Marker Cafe',
          extensions.st_setsrid(extensions.st_makepoint(-71.0950, 42.3489), 4326)::extensions.geography,
          'restaurant', 'Local test data')
  returning id
)
insert into place_deals (restaurant_id, kind, title, timing, schedule, source, source_url, checked_at)
select cafe.id, d.kind, d.title, d.timing, d.schedule::jsonb, 'curated', 'https://example.com/test', now()
from cafe,
     (values
       ('student', 'TEST: 10% off with student ID', 'any_time', null),
       ('special', 'TEST: daily happy hour', 'scheduled',
        '[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"24:00"}]')
     ) as d(kind, title, timing, schedule);
