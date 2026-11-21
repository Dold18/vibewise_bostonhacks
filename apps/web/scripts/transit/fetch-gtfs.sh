#!/usr/bin/env bash
# Re-download the raw MBTA GTFS feed into data/gtfs/ (gitignored) and rebuild the committed JSON.
# Usage (from anywhere): bash apps/web/scripts/transit/fetch-gtfs.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://cdn.mbta.com/MBTA_GTFS.zip -o "$TMP/MBTA_GTFS.zip"
rm -rf "$ROOT/data/gtfs" && mkdir -p "$ROOT/data/gtfs"
unzip -q "$TMP/MBTA_GTFS.zip" -d "$ROOT/data/gtfs"
node "$ROOT/apps/web/scripts/transit/build-transit-data.ts"
