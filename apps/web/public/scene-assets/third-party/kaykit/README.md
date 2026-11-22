# Vibenta — KayKit 3D asset import (initial collection)

This folder contains **12 actually imported 3D models** (6 haunted and 6 restaurant), sourced directly from the original official **KayKit / Kay Lousberg** GitHub repositories. They are separate from the 225 original v1/v2 SVG assets. These models are not yet used by the map.

- [Halloween Bits source](https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0)
- [Restaurant Bits source](https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0)
- License: **CC0 1.0 Universal**. The original LICENSE.txt is retained in each pack folder.
- Source assets: unmodified .gltf + matching .bin + shared .png per pack.
- Metadata: [manifest.v1.json](manifest.v1.json) with stable asset IDs, source paths, themes, placement-role candidates and honest QA states.
- **Verification done:** glTF JSON parsed, referenced external buffer and shared texture filenames matched; one full model + buffer + texture + license from each pack spot-checked byte-identical to their publisher's GitHub blobs.
- **Not done:** visual browser QA, geometry/scale orientation checks, WebGL renderer integration, GLB/Draco/meshopt optimization, GPU benchmarking, scene placements, quiz triggers, full-file SHA256 manifest.

To use an asset in a browser 3D renderer, keep the .gltf in the same directory as its named .bin file and the shared PNG. Only load selected assets in the future; do not preload entire catalogs.

**Examples for eventual thematic installations (not implemented):**
- Haunted hero vignette: arch_gate + tree_dead_large + lantern_hanging; optional pumpkin accent.
- Restaurant hero vignette: table_round_A_decorated + chair_A + menu; optional food_dinner accent.

Actual Italian-specific hero models (pizza, pasta, oven, vine-covered facade) still need model-level sourcing. Do not describe generic restaurant objects as specifically Italian.

**Map-safety rule:** all props are fictional stylizations, not geolocated ground truth. They must not occlude MBTA/walking paths, station icons, destination markers, attribution, or readable labels.
