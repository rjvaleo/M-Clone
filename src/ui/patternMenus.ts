// The Edit and Pattern menus, built once and used twice.
//
// M put these commands in the global menu bar, acting on whatever Pattern or
// Region was selected. This build also offers them by right-click inside the
// Pattern Editor, which is the same list — so it is built here, from the store
// alone, and both the menu bar and the context menu render it.
//
// Item order and labels come from engine/menus.ts, which is pinned to the
// manual by test. This file supplies the behaviour for each id.

import { useM } from "../state/store";
import * as cmd from "../engine/patterncmd";
import { EDIT_MENU_ITEMS, PATTERN_MENU_ITEMS, type MenuItemSpec } from "../engine/menus";
import type { MenuItem } from "./WindowMenu";
import type { StepEvent } from "../engine/types";

type Handler = { run: () => void; enabled?: boolean; label?: string; hint?: string };

/**
 * Assemble a menu from its manual-defined spec plus a table of behaviours.
 *
 * An id with no handler renders disabled, so a command the manual lists but
 * this build has not implemented still appears in its proper place instead of
 * quietly going missing.
 */
function build(spec: readonly MenuItemSpec[], handlers: Record<string, Handler>): MenuItem[] {
  return spec.map((item) => {
    if (item === "separator") return "separator";
    const handler = handlers[item.id];
    if (!handler) {
      return {
        label: item.label,
        hint: `${item.hint ?? item.label} — not yet wired up`,
        enabled: false,
        run: () => {},
      };
    }
    return {
      label: handler.label ?? item.label,
      hint: handler.hint ?? item.hint,
      enabled: handler.enabled,
      run: handler.run,
    };
  });
}

/** The Edit and Pattern menus for the currently selected Pattern and Region. */
export function usePatternMenus(): { editMenu: MenuItem[]; patternMenu: MenuItem[] } {
  const selectedVoice = useM((s) => s.selectedVoice);
  const voices = useM((s) => s.project.voices);
  const patterns = useM((s) => s.project.patterns);
  const clipboard = useM((s) => s.clipboard);
  const projectSeed = useM((s) => s.project.seed);
  const region = useM((s) => s.editorRegion);
  const setClipboard = useM((s) => s.setClipboard);
  const runPatternCommand = useM((s) => s.runPatternCommand);
  const runPatternDocumentCommand = useM((s) => s.runPatternDocumentCommand);
  const eraseSnapshot = useM((s) => s.eraseSnapshot);
  const currentSnapshot = useM((s) => s.currentSnapshot);

  const patternIndex = voices[selectedVoice].patternIndex;
  const pattern = patterns[patternIndex];

  // "The commands in the Pattern Menu operate on any selected Patterns or
  // Regions." With no Region selected they act on the whole Pattern, so the
  // Selector's region — minus a bare pointwise click — is the selection.
  const sel: cmd.Region =
    region && !region.point ? { from: region.from, to: region.to } : null;
  const selLabel = sel ? "Region" : "Pattern";
  const run = (fn: (steps: StepEvent[], maxSize: number) => StepEvent[]) => () =>
    runPatternCommand(patternIndex, fn);
  const hasClipboard = clipboard.length > 0;
  const pointwise = Boolean(sel || region?.point);

  const editMenu = build(EDIT_MENU_ITEMS, {
    cut: {
      hint: `Remove the ${selLabel} to the clipboard`,
      run: () => {
        setClipboard(cmd.copyRegion(pattern.steps, sel));
        runPatternCommand(patternIndex, (st) => cmd.clearSteps(st, sel));
      },
    },
    copy: {
      hint: `Copy the ${selLabel} to the clipboard`,
      run: () => setClipboard(cmd.copyRegion(pattern.steps, sel)),
    },
    paste: {
      hint: "Replace the selection with the clipboard",
      enabled: hasClipboard,
      run: run((st) => cmd.pasteSteps(st, sel, clipboard)),
    },
    pasteNotes: {
      hint: "Replace only the notes, leaving the length alone",
      enabled: hasClipboard,
      run: run((st) => cmd.pasteNotes(st, sel, clipboard)),
    },
    insertPaste: {
      // "If an entire Pattern is selected, this item is displayed as Paste At
      //  End. If a Region is selected, the command is displayed as Insert Paste."
      label: pointwise ? "Insert Paste" : "Paste at End",
      hint: pointwise
        ? "Push the clipboard in at the selection"
        : "Add the clipboard to the end of the Pattern",
      enabled: hasClipboard,
      run: run((st, maxSize) =>
        pointwise
          ? cmd.insertPaste(st, sel ? sel.from : region!.from, clipboard, maxSize)
          : cmd.pasteAtEnd(st, clipboard, maxSize)),
    },
    clear: {
      hint: `Delete the ${selLabel}`,
      run: run((st) => cmd.clearSteps(st, sel)),
    },
    changeToRests: {
      hint: `Empty the ${selLabel} without deleting steps`,
      run: run((st) => cmd.changeToRests(st, sel)),
    },
    fillWithRests: {
      hint: "Fill the whole Pattern to its Size with rests",
      run: run((st, maxSize) => cmd.fillWithRests(st, maxSize)),
    },
    eraseSnapshot: {
      // "This command clears the currently selected Snapshot... If no Snapshot
      //  is so marked, the menu item will be dimmed."
      hint: "Clear the currently selected Snapshot",
      enabled: currentSnapshot !== null,
      run: () => {
        if (currentSnapshot !== null) eraseSnapshot(currentSnapshot);
      },
    },
  });

  const patternMenu = build(PATTERN_MENU_ITEMS, {
    transposeUpHalf: { run: run((st) => cmd.transposeSteps(st, sel, 1)) },
    transposeDownHalf: { run: run((st) => cmd.transposeSteps(st, sel, -1)) },
    transposeUpOctave: { run: run((st) => cmd.transposeSteps(st, sel, 12)) },
    transposeDownOctave: { run: run((st) => cmd.transposeSteps(st, sel, -12)) },
    reScramble: {
      hint: `Generate a new Cyclic Random ordering of the ${selLabel}`,
      run: () => runPatternDocumentCommand(patternIndex, (current) =>
        cmd.reScramble(
          current,
          sel,
          projectSeed + patternIndex * 997 + (current.scrambleGeneration + 1) * 7919,
        )),
    },
    originalToScrambled: {
      hint: `Copy the ${selLabel}'s Original list to its Cyclic Random list`,
      run: () => runPatternDocumentCommand(patternIndex, (current) =>
        cmd.originalToScrambled(current, sel)),
    },
    swapScrambledAndOriginal: {
      hint: `Exchange the ${selLabel}'s Original and Cyclic Random lists`,
      run: () => runPatternDocumentCommand(patternIndex, (current) =>
        cmd.swapScrambledAndOriginal(current, sel)),
    },
    rotateForward: { run: run((st) => cmd.rotateForward(st, sel)) },
    rotateBackward: { run: run((st) => cmd.rotateBackward(st, sel)) },
    reverseOrder: { run: run((st) => cmd.reverseOrder(st, sel)) },
    doubleWithRests: { run: run((st, m) => cmd.doubleWithRests(st, sel, m)) },
    tripleWithRests: { run: run((st, m) => cmd.tripleWithRests(st, sel, m)) },
    eliminateChords: { run: run((st, m) => cmd.eliminateChords(st, sel, m)) },
    eliminateRests: { run: run((st) => cmd.eliminateRests(st, sel)) },
    openPatternEditor: {
      hint: "Open the Pattern Editor",
      run: () => window.dispatchEvent(
        new CustomEvent("mclone:open-window", { detail: "pattern-editor" }),
      ),
    },
  });

  return { editMenu, patternMenu };
}
