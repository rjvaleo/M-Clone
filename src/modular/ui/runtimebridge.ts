import type { NodeInstance, JsonValue } from "../model/graph";
import type { MorphPolicy } from "../runtime/parameters";

export type RuntimeLike = {
  start(): void;
  pause(): void;
  stop(): void;
  sync(): void;
  panic(): void;
  rescramble(nodeId: string): boolean;
  queueParameter(nodeId: string, parameterId: string, value: JsonValue, morph?: MorphPolicy): void;
};

export function queueRuntimeParameter(
  runtime: RuntimeLike | null,
  nodeId: string,
  parameterId: string,
  value: JsonValue,
  morph: MorphPolicy,
): void {
  runtime?.queueParameter(nodeId, parameterId, value, morph);
}

export function executeRuntimeCommand(
  runtime: RuntimeLike | null,
  node: NodeInstance,
  commandId: string,
  fallbackLabel: string,
  randomInt: (maxExclusive: number) => number = (maxExclusive) =>
    Math.floor(Math.random() * maxExclusive),
): { message: string; updates?: { parameterId: string; value: JsonValue; morph: MorphPolicy }[] } {
  if (!runtime) return { message: `${node.label}: runtime unavailable` };

  if (node.moduleType === "m.transport-clock") {
    if (commandId === "play") {
      runtime.start();
      return { message: `${node.label}: Play` };
    }
    if (commandId === "pause") {
      runtime.pause();
      return { message: `${node.label}: Pause` };
    }
    if (commandId === "stop") {
      runtime.stop();
      return { message: `${node.label}: Stop` };
    }
    if (commandId === "sync") {
      runtime.sync();
      return { message: `${node.label}: Sync` };
    }
  }

  if (commandId === "panic") {
    runtime.panic();
    return { message: `${node.label}: Panic` };
  }

  if (commandId === "rescramble") {
    const changed = runtime.rescramble(node.id);
    return { message: changed ? `${node.label}: ReScramble` : `${node.label}: no cyclic state to rescramble` };
  }

  if (commandId === "reseed" && node.moduleType === "m.note-density") {
    const seed = Math.max(1, randomInt(2_147_483_647));
    runtime.queueParameter(node.id, "seed", seed, "immediate");
    return {
      message: `${node.label}: New deterministic seed ${seed}`,
      updates: [{ parameterId: "seed", value: seed, morph: "immediate" }],
    };
  }

  return { message: `${node.label}: ${fallbackLabel}` };
}
