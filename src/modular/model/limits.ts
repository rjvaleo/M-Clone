/**
 * Modules a canvas may hold only so many of.
 *
 * M is one per canvas: it is the composer, and its tracks are what everything
 * else plays. Anything not listed is unlimited.
 */

import type { GraphDocument } from "./graph";

const LIMITS: Readonly<Record<string, number>> = {
  "m.m": 1,
};

export function moduleLimit(type: string): number {
  return LIMITS[type] ?? Infinity;
}

export function canAddModule(graph: GraphDocument, type: string): boolean {
  const count = Object.values(graph.nodes).filter((node) => node.moduleType === type).length;
  return count < moduleLimit(type);
}
