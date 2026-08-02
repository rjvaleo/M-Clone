import { quantizeDelay } from "../engine/snapshot";

export type SnapshotGesture = {
  quantize: number;
  tempo: number;
  elapsedSec: number;
  recall: () => void;
  forceSync?: boolean;
  sync?: () => void;
};

/** Execute a Snapshot on its rhythmic boundary, optionally forcing Sync. */
export function runSnapshotGesture(gesture: SnapshotGesture): void {
  const execute = () => {
    gesture.recall();
    if (gesture.forceSync) gesture.sync?.();
  };
  const delay = quantizeDelay(gesture.quantize, gesture.tempo, gesture.elapsedSec);
  if (delay <= 0) execute();
  else globalThis.setTimeout(execute, delay * 1000);
}
