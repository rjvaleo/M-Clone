/**
 * Classic M, running inside idMLab.
 *
 * This mounts M-Clone's own `App` rather than reimplementing it. That is the
 * whole point: the windows, the store, the generative engine and the seven
 * menus are the same code that passes M-Clone's own test suite, so "exactly as
 * it was" is a fact about what is running rather than a claim about a copy.
 *
 * `src/styles.css` is imported here rather than globally, so it only loads
 * with this view. The two stylesheets were checked for overlap before this
 * was wired: 400 M classes against 121 idMLab ones, sharing only `is-on` and
 * `is-selected`, and both of those are always compound-selected
 * (`.uconduct__transport button.is-on`, `.mm-node.is-selected`) — never bare.
 * There are no element selectors in M's sheet at all. So neither can reach
 * into the other.
 */

import { App } from "../../ui/App";
import "../../styles.css";

export function ClassicView({ onExit }: { onExit: () => void }) {
  return <App onExitToPatch={onExit} />;
}
