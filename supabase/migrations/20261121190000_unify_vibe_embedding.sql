-- Unify the vibe/embedding side of `restaurants` (docs/EMBEDDING_PIPELINE.md).
--
-- Accepted design: ONE combined description per restaurant (facts + vibe, concatenated)
-- and ONE embedding column (MiniLM, 384 dims). This removes the separate ambience layer,
-- the CLIP column and the vibe-score vocabulary that the first migration created.
--
-- Forward migration: 20261121120000_create_restaurants.sql is already applied and is left unchanged.
-- Destructive: drops columns and their data. They were never written by any app or pipeline code.

-- `fts` is generated from ambience_description, so it must be dropped first
-- (this also drops restaurants_fts_idx) and recreated without it.
alter table restaurants drop column fts;

alter table restaurants
  drop column ambience_description,
  drop column ambience_embedding,
  drop column ambience_clip_embedding,
  drop column vibe_scores,
  drop column vibe_vocab_version,
  drop column vibe_confidence,
  drop column vibe_sources;

alter table restaurants
  add column fts tsvector generated always as (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index restaurants_fts_idx on restaurants using gin (fts);

comment on column restaurants.description is
  'Combined passage embedded once: facts (cuisine, dishes, price tier, neighborhood) + vibe (atmosphere, mood, lighting, energy, occasion-fit). See docs/EMBEDDING_PIPELINE.md.';
comment on column restaurants.embedding is
  'MiniLM (all-MiniLM-L6-v2, 384 dims) embedding of `description`. The only embedding per restaurant.';
