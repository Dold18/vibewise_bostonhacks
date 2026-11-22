#!/usr/bin/env node
/**
 * Regenerates src/discovery/data/bostonLocations.generated.ts, the offline
 * starting-point suggestions used by the discovery panel.
 *
 * Nothing in that file is typed by hand: every coordinate comes from a source
 * record fetched here, and each entry keeps its source reference so it can be
 * re-checked.
 *
 * - MBTA rapid-transit stations: MBTA V3 API (/stops filtered per route).
 *   Governed by the MassDOT Developers License Agreement. No key is needed for
 *   this handful of requests (the keyless limit is 20 requests/minute).
 * - Universities and landmarks: OpenStreetMap elements pinned by ID below,
 *   read through the Overpass API (ODbL; attribute "© OpenStreetMap
 *   contributors"). Coordinates are the element's node position, or the
 *   Overpass `center` (bounding-box centre) for ways and relations.
 *
 * Run from apps/web:  node scripts/build-boston-locations.mjs
 * This is a development-time script; the app never calls these APIs for
 * autocomplete.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/discovery/data/bostonLocations.generated.ts', import.meta.url));
const USER_AGENT = 'vibewise-dataset-build/0.1 (BostonHacks dev script)';
const MBTA = 'https://api-v3.mbta.com';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Rapid-transit routes (GTFS route types 0 and 1) and how we name them. */
const ROUTES = [
  ['Red', 'Red Line'],
  ['Mattapan', 'Mattapan Line'],
  ['Orange', 'Orange Line'],
  ['Blue', 'Blue Line'],
  ['Green-B', 'Green Line'],
  ['Green-C', 'Green Line'],
  ['Green-D', 'Green Line'],
  ['Green-E', 'Green Line'],
];

/**
 * OSM elements, chosen by inspecting Overpass results (name, type, Wikidata
 * tag) where a name matched several features. `label` is what users see.
 */
const OSM_PLACES = [
  // Universities and colleges
  { ref: 'relation/6587738', kind: 'university', label: 'Boston University' },
  { ref: 'relation/3905196', kind: 'university', label: 'Northeastern University' },
  { ref: 'relation/65066', kind: 'university', label: 'MIT', aliases: ['Massachusetts Institute of Technology'] },
  // The university relation spans several campuses; Harvard Yard is the recognisable centre.
  { ref: 'relation/17336107', kind: 'university', label: 'Harvard University (Harvard Yard)', aliases: ['Harvard Yard'] },
  { ref: 'relation/17218279', kind: 'university', label: 'Boston College', aliases: ['BC', 'Chestnut Hill'] },
  { ref: 'relation/3567946', kind: 'university', label: 'Tufts University', aliases: ['Medford'] },
  { ref: 'node/1325838579', kind: 'university', label: 'Emerson College' },
  { ref: 'relation/11201448', kind: 'university', label: 'Suffolk University' },
  { ref: 'relation/17488356', kind: 'university', label: 'Berklee College of Music', aliases: ['Berklee'] },
  { ref: 'relation/8718853', kind: 'university', label: 'UMass Boston', aliases: ['University of Massachusetts Boston', 'Columbia Point'] },
  { ref: 'relation/11242618', kind: 'university', label: 'Simmons University' },
  { ref: 'relation/3067394', kind: 'university', label: 'Wentworth Institute of Technology', aliases: ['WIT'] },
  { ref: 'relation/3067396', kind: 'university', label: 'MassArt', aliases: ['Massachusetts College of Art and Design'] },
  { ref: 'way/88569914', kind: 'university', label: 'Emmanuel College' },
  { ref: 'relation/11234979', kind: 'university', label: 'Lesley University' },
  // Landmarks
  { ref: 'relation/17995454', kind: 'landmark', label: 'Boston Common' },
  { ref: 'way/23787885', kind: 'landmark', label: 'Boston Public Garden', aliases: ['Public Garden'] },
  { ref: 'way/29551702', kind: 'landmark', label: 'Faneuil Hall' },
  { ref: 'way/29573399', kind: 'landmark', label: 'Quincy Market' },
  { ref: 'way/29718019', kind: 'landmark', label: 'Massachusetts State House', aliases: ['State House'] },
  { ref: 'relation/11188464', kind: 'landmark', label: 'Fenway Park' },
  { ref: 'way/25123637', kind: 'landmark', label: 'TD Garden' },
  { ref: 'relation/63938', kind: 'landmark', label: 'Museum of Fine Arts', aliases: ['MFA'] },
  { ref: 'way/29650851', kind: 'landmark', label: 'Isabella Stewart Gardner Museum', aliases: ['Gardner Museum'] },
  { ref: 'way/29660091', kind: 'landmark', label: 'New England Aquarium', aliases: ['Aquarium'] },
  { ref: 'relation/21282658', kind: 'landmark', label: 'Museum of Science' },
  { ref: 'way/29660099', kind: 'landmark', label: "Boston Children's Museum" },
  { ref: 'relation/63755', kind: 'landmark', label: 'Boston Public Library (Central Library)', aliases: ['BPL', 'Copley Library'] },
  { ref: 'way/1239199995', kind: 'landmark', label: 'Copley Square' },
  { ref: 'relation/1626846', kind: 'landmark', label: 'Prudential Center', aliases: ['Pru'] },
  { ref: 'relation/1723651', kind: 'landmark', label: 'Christian Science Plaza' },
  { ref: 'way/29560864', kind: 'landmark', label: 'Symphony Hall' },
  { ref: 'way/29650592', kind: 'landmark', label: 'Old North Church' },
  { ref: 'way/240376785', kind: 'landmark', label: 'Paul Revere House' },
  { ref: 'way/166151194', kind: 'landmark', label: 'USS Constitution' },
  { ref: 'way/212124093', kind: 'landmark', label: 'Bunker Hill Monument' },
  { ref: 'way/405941805', kind: 'landmark', label: 'Boston Athenaeum' },
  { ref: 'relation/17737456', kind: 'landmark', label: 'Charles River Esplanade', aliases: ['Esplanade', 'Hatch Shell'] },
  { ref: 'relation/17488385', kind: 'landmark', label: 'Back Bay Fens', aliases: ['The Fens'] },
  { ref: 'relation/64871', kind: 'landmark', label: 'Arnold Arboretum' },
  { ref: 'relation/11281269', kind: 'landmark', label: 'Jamaica Pond' },
  { ref: 'relation/11192367', kind: 'landmark', label: 'Castle Island' },
  { ref: 'way/409161379', kind: 'landmark', label: 'Seaport Common', aliases: ['Seaport'] },
  { ref: 'node/2448023622', kind: 'landmark', label: 'Harvard Square' },
  { ref: 'node/13130783050', kind: 'landmark', label: 'Kendall Square' },
];

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

async function mbtaStations() {
  const stations = new Map();
  for (const [routeId, lineName] of ROUTES) {
    const params = new URLSearchParams({
      'filter[route]': routeId,
      'fields[stop]': 'name,latitude,longitude,municipality,location_type',
    });
    const json = await getJson(`${MBTA}/stops?${params}`);
    for (const stop of json.data) {
      const a = stop.attributes;
      if (typeof a.latitude !== 'number' || typeof a.longitude !== 'number') continue;
      const existing = stations.get(stop.id);
      if (existing) {
        if (!existing.lines.includes(lineName)) existing.lines.push(lineName);
        if (routeId.startsWith('Green-')) existing.branches.add(routeId.slice(6));
        continue;
      }
      stations.set(stop.id, {
        id: stop.id,
        name: a.name,
        municipality: a.municipality ?? undefined,
        lat: round6(a.latitude),
        lng: round6(a.longitude),
        lines: [lineName],
        branches: new Set(routeId.startsWith('Green-') ? [routeId.slice(6)] : []),
      });
    }
  }
  return [...stations.values()].map((s) => {
    const lines = s.lines.map((l) => (l === 'Green Line' && s.branches.size ? `Green Line (${[...s.branches].sort().join(', ')})` : l));
    return {
      id: `mbta:${s.id}`,
      kind: 'station',
      label: `${s.name} station`,
      secondary: `MBTA ${lines.join(' · ')}${s.municipality && s.municipality !== 'Boston' ? ` · ${s.municipality}` : ''}`,
      aliases: [s.name],
      location: { lat: s.lat, lng: s.lng },
      source: { provider: 'mbta-v3', ref: s.id },
    };
  });
}

async function osmPlaces() {
  const byType = { node: [], way: [], relation: [] };
  for (const p of OSM_PLACES) {
    const [type, id] = p.ref.split('/');
    byType[type].push(id);
  }
  const query = `[out:json][timeout:60];(${Object.entries(byType)
    .filter(([, ids]) => ids.length)
    .map(([type, ids]) => `${type}(id:${ids.join(',')});`)
    .join('')});out center tags;`;
  const json = await getJson(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) });
  const found = new Map(json.elements.map((e) => [`${e.type}/${e.id}`, e]));
  return OSM_PLACES.map((p) => {
    const e = found.get(p.ref);
    if (!e) throw new Error(`OSM element ${p.ref} (${p.label}) not found — re-check the pinned ID`);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') throw new Error(`No position for ${p.ref}`);
    const t = e.tags ?? {};
    const area = t['addr:city'] ?? t['addr:suburb'];
    return {
      id: `osm:${p.ref}`,
      kind: p.kind,
      label: p.label,
      secondary: `${p.kind === 'university' ? 'University' : 'Landmark'}${area ? ` · ${area}` : ''}`,
      aliases: [...new Set([...(p.aliases ?? []), ...(t.name && t.name !== p.label ? [t.name] : [])])],
      location: { lat: round6(lat), lng: round6(lon) },
      source: { provider: 'openstreetmap', ref: p.ref, ...(t.wikidata ? { wikidata: t.wikidata } : {}) },
    };
  });
}

const retrievedAt = new Date().toISOString().slice(0, 10);
const [stations, places] = await Promise.all([mbtaStations(), osmPlaces()]);
const all = [...places, ...stations.sort((a, b) => a.label.localeCompare(b.label))].map((entry) => ({
  ...entry,
  source: { ...entry.source, retrievedAt },
}));

const header = `/*
 * GENERATED by scripts/build-boston-locations.mjs on ${retrievedAt}. Do not edit by hand;
 * rerun the script instead.
 *
 * Sources:
 * - MBTA V3 API /stops (MassDOT Developers License Agreement): ${stations.length} rapid-transit stations.
 * - OpenStreetMap via Overpass (© OpenStreetMap contributors, ODbL): ${places.length} universities and landmarks.
 *   Ways/relations use the Overpass bounding-box centre, so large areas are approximate.
 */
import type { LocalLocation } from '../locations';

export const BOSTON_LOCATIONS: readonly LocalLocation[] = `;
// One entry per line keeps diffs of regenerated data reviewable.
writeFileSync(OUT, `${header}[\n${all.map((entry) => `  ${JSON.stringify(entry)},`).join('\n')}\n];\n`);
console.log(`Wrote ${all.length} locations (${stations.length} stations, ${places.length} OSM places) to ${OUT}`);
