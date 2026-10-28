/**
 * The patch, for the module faces that read other modules (M Variables
 * reading the NoteSeqs, Orchestra counting voices, the edit windows editing
 * M Variables). Each face selects only what it shows; an edit re-renders the
 * faces whose selection changed, not every face that can see the graph.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { emptyGraph, type GraphDocument } from "../model/graph";

export class GraphStore {
  private graph: GraphDocument;
  private readonly listeners = new Set<() => void>();

  constructor(graph: GraphDocument) {
    this.graph = graph;
  }

  get(): GraphDocument {
    return this.graph;
  }

  set(graph: GraphDocument): void {
    if (graph === this.graph) return;
    this.graph = graph;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/** Two selections are the same when every item is the same object. */
export const sameItems = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** A snapshot reader that hands back the previous selection while it is equal, so React sees no change. */
export function cachedSelection<S, T>(source: () => S, select: (source: S) => T, equal: (a: T, b: T) => boolean): () => T {
  let has = false;
  let last: T;
  return () => {
    const next = select(source());
    if (has && equal(last, next)) return last;
    has = true;
    last = next;
    return next;
  };
}

export const GraphStoreContext = createContext<GraphStore>(new GraphStore(emptyGraph()));

/** What a face reads from the patch, re-rendering it only when that changes. */
export function useGraphSelection<T>(select: (graph: GraphDocument) => T, equal: (a: T, b: T) => boolean): T {
  const store = useContext(GraphStoreContext);
  // The selector is the face's own: one cache per mounted face.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => cachedSelection(() => store.get(), select, equal), [store]);
  return useSyncExternalStore((listener) => store.subscribe(listener), read);
}
