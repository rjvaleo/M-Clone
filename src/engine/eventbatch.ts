import { compareEngineEvents, type EngineEvent } from "./events";

export const EVENT_BATCH_VERSION = 1;

export type EventBatchV1 = {
  version: 1;
  destinationId: string;
  events: EngineEvent[];
};

export function encodeEventBatch(
  events: readonly EngineEvent[],
  destinationId: string,
): Uint8Array {
  const batch: EventBatchV1 = {
    version: EVENT_BATCH_VERSION,
    destinationId,
    events: [...events].sort(compareEngineEvents),
  };
  return new TextEncoder().encode(JSON.stringify(batch));
}

function isEngineEvent(value: unknown): value is EngineEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return ["note-on", "note-off", "program-change"].includes(String(event.type))
    && ["midi", "synth"].includes(String(event.destination))
    && ["atSec", "atTick", "sequence", "voice", "channel"]
      .every((key) => typeof event[key] === "number" && Number.isFinite(event[key]));
}

export function decodeEventBatch(bytes: Uint8Array): EventBatchV1 {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Invalid event batch JSON");
  }
  if (typeof value !== "object" || value === null) throw new Error("Invalid event batch");
  const batch = value as Record<string, unknown>;
  if (batch.version !== EVENT_BATCH_VERSION) throw new Error("Unsupported event batch version");
  if (typeof batch.destinationId !== "string" || !Array.isArray(batch.events)
    || !batch.events.every(isEngineEvent)) throw new Error("Invalid event batch payload");
  return {
    version: EVENT_BATCH_VERSION,
    destinationId: batch.destinationId,
    events: [...batch.events].sort(compareEngineEvents),
  };
}
