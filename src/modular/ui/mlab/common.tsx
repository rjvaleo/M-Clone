/**
 * What the M module faces share: the host that lets one face reach the other
 * M modules on the canvas, and the a–f position buttons.
 */

import { createContext, useContext } from "react";
import type { GraphDocument, JsonValue, NodeInstance } from "../../model/graph";
import { POSITION_LABELS } from "../../mlab/model";
import { N4Button } from "../n4/kit";
import { presetHandlers } from "../n4/PresetManager";
import { snapshotOf } from "../../mlab/presets";

export type MLabFaceProps = {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
  setParameters: (values: Record<string, JsonValue>) => void;
  status: Readonly<Record<string, string>>;
};

export type MLabHost = {
  /** The patch as it is now, for reading at the moment of an edit. To show
   * another module, select it with useGraphSelection instead, so the face
   * re-renders when that module changes and not on every edit. */
  getGraph: () => GraphDocument;
  /** Write parameters on another node, as its own face would. */
  setNodeParameters: (nodeId: string, values: Record<string, JsonValue>) => void;
  /** Send a command to a node's processor. */
  command: (nodeId: string, commandId: string) => void;
  /** Run a module command as its own button would, transport commands included. */
  run: (nodeId: string, commandId: string, label: string) => void;
  /** The live waveform leaving a module; false while audio is off. */
  readScope?: (nodeId: string, into: Float32Array) => boolean;
};

export const MLabHostContext = createContext<MLabHost | null>(null);
export const useMLabHost = () => useContext(MLabHostContext);

export const findNodeOfType = (graph: GraphDocument | undefined, type: string): NodeInstance | undefined =>
  graph ? Object.values(graph.nodes).find((node) => node.moduleType === type) : undefined;

export const param = <T,>(node: NodeInstance, id: string, fallback: T): T =>
  (node.parameters[id] as unknown as T | undefined) ?? fallback;

/** Six positions, a–f, as a row of Numerology buttons. */
export function PositionButtons({ value, onPick, label }: { value: number; onPick: (position: number) => void; label: string }) {
  return (
    <div className="n4-positions" role="group" aria-label={label}>
      {POSITION_LABELS.map((name, position) => (
        <N4Button small key={name} on={position === value} onClick={() => onPick(position)}>{name}</N4Button>
      ))}
    </div>
  );
}

/** A module's preset manager, wired to its parameters. */
export const usePresets = (node: NodeInstance, setParameters: (values: Record<string, JsonValue>) => void) =>
  presetHandlers(node.parameters, () => snapshotOf(node.parameters), setParameters as (values: Record<string, unknown>) => void);
