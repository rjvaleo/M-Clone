// Which kit a node face draws its controls with — the shape axis, alongside
// the colour axis `themes.ts` already owns. A context rather than a prop
// threaded through every control, for the same reason `SoundPoolContext`
// exists: the kit changes from one place (a picker, eventually next to the
// theme picker) and has nothing to do with any individual node's own props,
// so passing it by hand would mean every node re-rendering for a setting it
// does not otherwise care about.
//
// Defaults to "thinRing" rather than the first entry in KIT_IDS: it is the
// kit closest to idMLab's existing dark canvas, so a face rendered with no
// provider — the gallery's per-card previews, or a future test — still looks
// native rather than defaulting to whichever kit happened to be declared
// first.

import { createContext, useContext } from "react";
import type { KitId } from "./types";

export const KitContext = createContext<KitId>("thinRing");

export const useKit = (): KitId => useContext(KitContext);
