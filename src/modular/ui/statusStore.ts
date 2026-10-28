/**
 * Every module's status line — the playing step, the bar and beat, voices
 * sounding — kept outside React state. The poll writes it ten times a second;
 * a module's readouts subscribe to their own module's status, so a tick
 * re-renders the readouts that changed and nothing else: not the app, not the
 * other modules, not the rest of the face.
 */

import { createContext, useContext, useSyncExternalStore } from "react";

export type NodeStatus = Readonly<Record<string, string>>;
const NO_STATUS: NodeStatus = Object.freeze({});

export class StatusStore {
  private values = new Map<string, NodeStatus>();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(nodeId: string): NodeStatus {
    return this.values.get(nodeId) ?? NO_STATUS;
  }

  /** Replace every status; each module whose status changed hears about it. */
  set(next: Readonly<Record<string, NodeStatus>>): void {
    const changed: string[] = [];
    const values = new Map<string, NodeStatus>();
    for (const [nodeId, value] of Object.entries(next)) {
      const previous = this.values.get(nodeId);
      if (previous && JSON.stringify(previous) === JSON.stringify(value)) values.set(nodeId, previous);
      else { values.set(nodeId, value); changed.push(nodeId); }
    }
    for (const nodeId of this.values.keys()) if (!(nodeId in next)) changed.push(nodeId);
    this.values = values;
    for (const nodeId of changed) for (const listener of this.listeners.get(nodeId) ?? []) listener();
  }

  subscribe(nodeId: string, listener: () => void): () => void {
    const set = this.listeners.get(nodeId) ?? new Set();
    set.add(listener);
    this.listeners.set(nodeId, set);
    return () => { set.delete(listener); };
  }
}

export const StatusStoreContext = createContext<StatusStore>(new StatusStore());

/** One module's status, re-rendering the caller only when that module's status changes. */
export function useNodeStatus(nodeId: string): NodeStatus {
  const store = useContext(StatusStoreContext);
  return useSyncExternalStore((listener) => store.subscribe(nodeId, listener), () => store.get(nodeId));
}
