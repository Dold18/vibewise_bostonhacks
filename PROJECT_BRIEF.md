# Project brief: transit-first food discovery for Boston students

This document briefs an agent joining the project. It covers the goal, the decided architecture, open decisions, constraints, and the build priorities for a weekend hackathon. Items marked **Decided** should not be revisited without asking the team. Items marked **Open** need a decision from the team.

## 1. Context

**Event:** BostonHacks 2026.

**Track:** "Bos(tons) of Eats and Streets." Build a web application for college students that leverages Boston's public transit (the MBTA) to help them discover and navigate food spots, local activities, and the Boston aesthetic based on their cravings, budget, and location. The track emphasizes that students don't have cars, care about cost (e.g. cheap eats off the Orange Line), and need late-night options (e.g. a restaurant open past 3am during finals week).

**Our product:** A website with a stylized map of Boston that overlays restaurants, highlights MBTA lines and stations, and prioritizes estimated total cost (food plus fare). Its signature feature is a **Vibe tab**: users describe what they want in text, or upload an image or a song, and the app recommends matching restaurants reachable by transit.

## 2. Core features

1. **Map view.** Stylized Boston map with MBTA lines in their official route colors, stations, and restaurant markers. Clicking a restaurant shows its profile, nearest station(s), walking time from the station, and estimated total cost.
2. **Vibe tab.** Three input modes:
   - **Text:** e.g. "cozy ramen place for a rainy night."
   - **Image:** e.g. a photo of a dish or an aesthetic.
   - **Song:** an uploaded audio file.
   All three produce ranked restaurant results shown on the map and in a list.
3. **Filters.** Budget (max total cost), open now, maximum travel effort (e.g. walking minutes from a station, or which lines), cuisine.
4. **Cost estimate.** Each result shows an estimated meal cost plus round-trip fare. Sorting by total cost should be easy.
5. **Late-night awareness.** When the T is closed or about to close, results must say so (e.g. "last train back leaves at 12:38am" or "no train service; night bus or walk"). Never show a T route that isn't running.

## 3. Architecture overview

The system has two phases that share one embedding model.

### 3.1 Phase 1: offline indexing (batch job)

1. **Restaurant list.** Pull restaurants with coordinates, cuisine tags, and website URLs from open map data (OpenStreetMap via Overpass, and/or Foursquare Open Source Places, which is Apache 2.0 licensed). **Do not** source restaurant data or website URLs from the Google Places API (see constraints).
2. **Scrape** each restaurant's website: menu pages, about pages. Handle PDFs and image menus where feasible (text extraction or OCR). Respect `robots.txt`, rate-limit, use an honest user agent. Skip menus hosted on third-party ordering or delivery platforms.
3. **Normalize** each scraped site with an LLM into a standardized profile (see section 5.1). This runs offline, so cost and latency don't matter much.
4. **Embed** each profile's description text with the embedding model.
5. **Store** vectors plus metadata in Supabase.
6. **Precompute transit proximity:** for each restaurant, the nearest MBTA stations within roughly 800 m and the walking distance to each.

### 3.2 Phase 2: online query (per request)

1. **Text input** goes straight to the embedding model.
2. **Image or song input** goes to Gemini first, which returns structured JSON (section 5.2). Only the `description` field is embedded; the other fields are used for filtering and boosting.
3. **Filter** candidates in SQL: geographic radius or transit reachability, open now, budget.
4. **Rank** with hybrid search: pgvector cosine similarity combined with Postgres full-text search via reciprocal rank fusion (section 6).
5. **Return** the top results with transit info and cost estimates, rendered on the map.

## 4. Tech stack

| Component | Choice | Status |
|---|---|---|
| Language | TypeScript | **Decided** |
| Embedding model | `Xenova/all-MiniLM-L6-v2` or `Xenova/bge-small-en-v1.5` via Transformers.js (`@huggingface/transformers`), 384 dimensions | **Decided** (pick one and never mix) |
| Embedding location | Server-side (Node or a Supabase Edge Function) | Recommended |
| Database | Supabase (Postgres + pgvector + PostGIS + full-text search) | **Decided** |
| Multimodal translation | Gemini (image and audio input, JSON output) | **Decided** |
| Offline normalizer LLM | Any capable LLM (Gemini is fine) | Open |
| Frontend framework | e.g. Next.js or Vite + React | Open |
| Map library | Depends on the review-data decision (section 8) | Open |
| Transit data | MBTA V3 API (free, needs API key) and MBTA GTFS static feed | **Decided** |

Critical rule: the embedding model used for queries must be **identical** to the one used for indexing, including quantization if possible. Changing the model means re-embedding the whole index and altering the vector column dimension.

If using BGE, queries (not documents) need the prefix `"Represent this sentence for searching relevant passages: "`.

## 5. Data contracts

### 5.1 Restaurant profile (output of the offline normalizer)

```json
{
  "cuisines": ["Japanese", "Ramen"],
  "signature_dishes": ["tonkotsu ramen", "gyoza"],
  "dietary_options": ["vegetarian options"],
  "price_feel": "cheap",
  "median_entree_price": 16.0,
  "description": "Casual Japanese ramen shop serving rich tonkotsu and miso ramen, gyoza, and rice bowls."
}
```

The `description` is what gets embedded. It should be cuisine- and dish-focused, written in a consistent style across all restaurants, and free of boilerplate (hours, catering forms, gift cards). The normalizer should extract `median_entree_price` from menu prices when available and return `null` otherwise.

### 5.2 Gemini output for image and song queries

Gemini must be instructed to return only JSON in this shape, at low temperature:

```json
{
  "cuisines": [{ "name": "Spanish", "confidence": 0.8 }],
  "dishes": ["paella", "patatas bravas"],
  "price_feel": "moderate",
  "signal_strength": "strong",
  "description": "Spanish tapas restaurant serving paella, patatas bravas, and sangria."
}
```

Requirements:

- The `description` must mimic the style and vocabulary of the restaurant profile descriptions (this is the HyDE technique; it makes query and document embeddings comparable).
- The prompt should push toward cuisine and dishes rather than abstract mood words, since restaurant documents contain menus, not moods.
- `signal_strength` can be `"strong"`, `"weak"`, or `"none"`. Many songs and images carry no real cuisine signal. When weak or none, the app should fall back to other ranking signals (price, distance, popularity) rather than trust an arbitrary guess, and may tell the user the vibe was ambiguous.
- Strip code fences and parse defensively; handle malformed JSON with a retry or a graceful error.

## 6. Retrieval and ranking

### 6.1 Similarity

Vectors are normalized, so cosine similarity equals the dot product. pgvector's `<=>` operator returns cosine distance; similarity is `1 - distance`.

$$\text{sim}(\mathbf{q}, \mathbf{d}) = \frac{\mathbf{q} \cdot \mathbf{d}}{\|\mathbf{q}\| \, \|\mathbf{d}\|}$$

### 6.2 Hybrid search

Embeddings are weak at exact rare terms like specific dish names ("birria", "xiao long bao"). Combine vector ranking with Postgres full-text ranking (`tsvector` with a GIN index) using reciprocal rank fusion. Supabase documents this pattern in its hybrid search guide; adapt it rather than writing from scratch.

$$\text{RRF}(r) = \frac{w_v}{k + \text{rank}_{\text{vec}}(r)} + \frac{w_t}{k + \text{rank}_{\text{fts}}(r)}$$

with $k \approx 50$ to $60$ and weights tuned on the test set.

### 6.3 Cuisine boost for Vibe queries

For image and song queries, add a small boost when a restaurant's cuisine tags match Gemini's guesses:

$$\text{score}(r) = \text{RRF}(r) + \lambda \cdot c_r$$

where $c_r$ is Gemini's confidence for a matching cuisine (zero if none) and $\lambda$ is small. Skip the boost when `signal_strength` is not `"strong"`.

### 6.4 Filters before ranking

Hard constraints are SQL `WHERE` clauses, never embedding concerns: geographic radius or station proximity (PostGIS `ST_DWithin`), open now, max budget, dietary needs.

### 6.5 Vector index

At city scale (thousands of restaurants, a few hundred after filtering) an exact scan is fast and accurate. **Do not add an HNSW index for the MVP.** Approximate indexes combined with strict filters can return too few results.

### 6.6 Stretch: reranking and diversity

- A small cross-encoder reranker (e.g. `bge-reranker-base`) on the top 20 to 50 candidates.
- Maximal marginal relevance to avoid five near-identical results.

## 7. Database schema (sketch)

```sql
create extension if not exists vector;
create extension if not exists postgis;

create table restaurants (
  id bigint generated by default as identity primary key,
  source text not null,               -- 'osm' | 'foursquare'
  source_id text not null,
  name text not null,
  location geography(point) not null,
  address text,
  website text,
  cuisines text[],
  hours jsonb,                        -- normalized opening hours
  median_entree_price numeric,
  price_feel text,
  profile jsonb,                      -- full normalized profile (section 5.1)
  description text,
  fts tsvector generated always as (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,''))) stored,
  embedding vector(384),
  last_scraped_at timestamptz,
  attribution text,                   -- required license attribution for the source
  unique (source, source_id)
);

create index on restaurants using gist (location);
create index on restaurants using gin (fts);

create table stations (
  id text primary key,                -- MBTA stop/parent station id
  name text not null,
  lines text[] not null,              -- e.g. {'Orange','Green-B'}
  location geography(point) not null
);

create table restaurant_stations (
  restaurant_id bigint references restaurants(id),
  station_id text references stations(id),
  walk_meters numeric not null,
  primary key (restaurant_id, station_id)
);
```

Search logic should live in SQL functions called from TypeScript with `supabase.rpc(...)`, passing the query embedding as a number array.

## 8. Open decision: review data

The team wants to show reviews. **Google Places reviews are a problem on two counts:** Google's terms generally prohibit storing Places content (only place IDs may be stored indefinitely), and the Places API service-specific terms prohibit using Places content in conjunction with a non-Google map. Options:

1. **Build the stylized map on Google Maps** (custom map styling), fetch reviews live per restaurant at display time, show required Google attribution, and never store them. Restaurant data and embeddings still come from open sources.
2. **No third-party reviews.** Use an open base map (e.g. MapLibre with OSM-based tiles), show scraped profile data, and add in-app student reviews (seeded by the team for the demo).
3. Another review source, but check its terms first; most review platforms restrict storage and scraping.

Do not build anything that stores Google content or shows it on a non-Google map until the team chooses. Verify the current Google Maps Platform terms before implementing option 1.

## 9. MBTA integration

- **Data:** MBTA V3 API (stops, routes, schedules, predictions, alerts) and the GTFS static feed for station locations and route colors (`route_color`). Get a free API key from the MBTA developers site.
- **MVP routing (simple):** Nearest station to the user plus nearest station to the restaurant, the lines involved, and walking time from the station to the restaurant (assume about 80 m per minute of walking). Show whether the trip is direct on one line or needs a transfer.
- **Stretch routing:** Full trip planning with OpenTripPlanner (GTFS plus OSM). Do not use Google Directions on a non-Google map.
- **Late night:** Use MBTA schedules to determine whether service is running and when the last train back departs. Restaurants open after service ends must be labeled clearly.
- **Alerts:** Optionally surface service alerts (shuttles, closures) for lines a result depends on.
- **Attribution:** Follow MBTA developer terms for data attribution.

## 10. Cost estimate

$$\text{total cost} = \text{meal estimate} + 2 \times \text{fare}$$

- **Meal estimate:** `median_entree_price` from scraped menus when available; otherwise derive a range from `price_feel` and label it as an estimate.
- **Fare:** Pull current MBTA fares from the MBTA's official site at build time and keep them in config. **Do not hardcode fares from memory.** If the trip uses a bus, use the bus fare. Consider a toggle for users with a monthly pass or reduced fare, which sets the fare component to zero or the reduced amount.
- Always display cost as an estimate.

## 11. Constraints and compliance

- **No Google Places data in our database.** Only place IDs may be stored if Google is used at all.
- **Scraping:** respect `robots.txt`, rate-limit, identify the crawler. Use scraped text for embedding and ranking; avoid displaying long verbatim passages of a restaurant's prose. Facts (dish names, prices) are fine to display.
- **Licenses:** OSM data is ODbL (attribution required; share-alike applies to publicly distributed derived databases). Foursquare OS Places is Apache 2.0 (preserve its attribution notice). Display attribution in the app.
- **Hackathon rules:** Check BostonHacks 2026 rules on pre-written code and pre-collected data before doing any work in advance.

## 12. Scope and priorities for the weekend

**MVP (must work for the demo):**

1. Restaurant data for a limited area: restaurants within about 800 m of T stations in student-heavy neighborhoods (e.g. along the Green Line near BU and Northeastern, Orange Line, Red Line near Harvard and MIT). A few hundred well-profiled restaurants beats thousands of thin ones.
2. Scrape, normalize, embed, and store that subset.
3. Map with MBTA lines, stations, and restaurant markers.
4. Text search in the Vibe tab with filters (budget, open now) and hybrid ranking.
5. Restaurant detail card with nearest station, walk time, and cost estimate.

**Next:** image input via Gemini, then song input via Gemini, then late-night last-train labels.

**Stretch:** reranker, MMR diversity, full trip planning, service alerts, in-app reviews.

## 13. Evaluation

Build a small test set early: about 30 queries (text, plus some images and songs) with restaurants the team considers good answers. Use it to compare the two embedding models, description formats, Gemini prompts, RRF weights, and the cuisine boost. Don't tune by eyeballing.

## 14. Known risks

- **Scraping is the most labor-intensive part.** Many restaurants have no website, image-only menus, or JavaScript-heavy sites. Budget time accordingly and fall back to OSM/Foursquare metadata (name, cuisine tags) for restaurants without usable sites.
- **Song-to-food mapping is subjective.** Lean on `signal_strength` and be honest in the UI when the match is loose.
- **Stale data.** Restaurants close and menus change; drop entries flagged closed in the source data.
