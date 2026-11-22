/** Bundle only the small manifests; model bytes stay lazy, local and same-origin. */
import kaykit from '../../../public/scene-assets/third-party/kaykit/manifest.v1.json';
import modelibr from '../../../public/scene-assets/third-party/modelibr/manifest.v1.json';
import svgV1 from '../../../public/scene-assets/v1/manifest.json';
import svgV2 from '../../../public/scene-assets/v2/manifest.json';
import layouts from '../../../public/scene-assets/third-party/composites/layouts.v1.json';
import requirementsMap from '../../../public/scene-assets/v1/requirements-map.v1.json';
import { buildAssetRegistry } from './assets';
export const { registry: runtimeAssets, problems: registryProblems } = buildAssetRegistry({ kaykit, modelibr, svgV1, svgV2, layouts, requirementsMap });
/** The model/layout manifests, for the composer's asset tag index (city/composer.ts). */
export const runtimeManifests = { kaykit, modelibr, layouts } as const;
