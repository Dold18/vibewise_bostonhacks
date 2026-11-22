# PBR Material Importer

This folder supplies the **offline build tool** at \`scripts/import-polyhaven-textures.mjs\`, which downloads actual CC0 1K material maps from Poly Haven (when developer network access is available).

## Run locally (project root)

\`\`\`bash
node scripts/import-polyhaven-textures.mjs --dry-run --limit 12
node scripts/import-polyhaven-textures.mjs --limit 12 --max-mb 25
\`\`\`

The script queries Poly Haven's live API, selects 1K albedo/OpenGL normal/roughness files where available, verifies upstream MD5 when published, records SHA-256 hashes and source URLs, and refuses downloads that exceed the configured budget or 3 MB per file.

The default candidate list is intentionally broad. Unavailable or renamed asset IDs are skipped and reported, **not** treated as downloaded. Never imply these are in the repository until they have actually been imported and the generated manifest exists.

### Implementation status

- The 33 v1 SVG assets and 192 v2 SVG texture variants are already on the asset PR.
- The user-downloadable **192-material WebP atlas ZIP** is a separate generated artifact in the ChatGPT conversation, not committed into GitHub.
- No actual Poly Haven PBR download has run in this environment (outbound binary connections blocked).
- No custom shader or material-texture mapping system is implemented yet.

### License

The Poly Haven material files are CC0: https://polyhaven.com/license
The live API's terms and required user-agent/credit are described at https://polyhaven.com/our-api . This importer is a developer build-time utility, not a live app API. Keep per-file provenance and do not include proprietary previews.
