// Each Grain Engine's grains, as its worker last enumerated them, for the
// cloud pad to draw. Outside React on purpose: the pad is redrawn at frame
// rate by `CloudAnimator`, which reads this rather than a render.

import type { GrainCloud } from "./wasm/grainJobs";

const clouds = new Map<string, GrainCloud>();
let version = 0;

export function setGrainCloud(nodeId: string, cloud: GrainCloud | null): void {
  if (cloud) clouds.set(nodeId, cloud);
  else clouds.delete(nodeId);
  version += 1;
}

export const grainCloud = (nodeId: string): GrainCloud | undefined => clouds.get(nodeId);

/** Moves whenever any cloud does, so a drawing can tell it is stale. */
export const grainCloudsVersion = (): number => version;
