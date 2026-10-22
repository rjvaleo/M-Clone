/**
 * M itself, as one node.
 *
 * Not decomposed: the whole of M — its windows, store and composing runtime —
 * is the node's face, and the canvas sees only what comes out of it. Each of
 * M's tracks is a note output, cabled to whichever sound module should play
 * it. M makes no audio of its own on the canvas, so the node has no audio
 * port and never enters the audio plan.
 */

import type { ModuleDescriptor } from "../model/graph";
import { custom, defineModule, noteSignal, output, section } from "./descriptorKit";

export const M_NODE_TYPE = "m.m";
/** M's voices. The document grows to eight in a later phase. */
export const M_TRACKS = 4;

export const trackPort = (track: number): string => `track-${track + 1}-out`;

export const M_MODULE: ModuleDescriptor = defineModule({
  type: M_NODE_TYPE,
  label: "M",
  family: "source",
  layout: "editor",
  colorToken: "pattern",
  ports: Array.from({ length: M_TRACKS }, (_, track) =>
    output(trackPort(track), `Track ${track + 1}`, noteSignal())),
  face: [{ ...section("m", "M", [custom("m-app", "M")]), showHeading: false }],
});
