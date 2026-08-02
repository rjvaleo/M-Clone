# M 2.7 Manual Conformance Audit

**Audited:** 2026-08-01  
**Source:** all 194 pages of [`../reference/M27.pdf`](../reference/M27.pdf), with
Chapters 13–22 and Appendix A/B treated as the canonical reference when tutorial
chapters repeat a behavior.

## Method

Every distinct musical, editing, transport, file, menu, MIDI, window,
modifier-key, and performance behavior has a stable capability id in
`src/manual/manualConformance.ts`. The PDF was extracted page-by-page; the
reference/control section and Input Control keyboard map were also rendered and
visually inspected.

Run the executable audit with:

```bash
npm run test:manual
```

The focused engine/state/UI tests supply the behavioral evidence. The manual
suite verifies that every inventory item has a disposition and that no
implemented gap silently falls out of the work queues.

## Current result

The inventory contains **180 distinct manual capabilities**:

| Result | Capabilities | Meaning |
| --- | ---: | --- |
| Pass | **163** | Implemented with behavioral evidence |
| Partial | **0** | No retained partial capability |
| Fail | **0** | No retained absent capability |
| Not applicable | **17** | Explicit product/browser/manual exception |

The executable suite includes four integrity/queue assertions, so Vitest reports
**184 tests: 167 passed, 17 skipped**. Both ordered work queues are empty:
`EXISTING_FUNCTIONALITY_GAP_IDS` and `NEW_FUNCTIONALITY_IDS` contain no ids.

## Gap-closure outcome

The existing-functionality queue was closed first. It completed the classic
desktop gestures, Variable and Pattern operations, Snapshot/conducting paths,
Options consumers, Startup/File behavior, MIDI output setup, channel-mode
messages, and editor range/counter behavior.

The new-capability queue then added:

- live Web MIDI input with sixteen physical-device/channel assignments;
- per-Voice Source, Use, Echo-Thru, Echo Map, and Keyboard Transpose;
- Single, Chord, and Build recording with Insert, Replace, Overdub, Drum
  Machine following, edit range/counter, and sustain-entered rests;
- `sa` Step Advance, individual/all keyboard stepping, and Mouse Advance;
- the Appendix B MIDI Input Control System, including Variable, Pattern Group,
  Cyclic, Snapshot, Slideshow, transport, tempo, tap, and Time Base commands;
- controller-driven conducting and configurable X/Y controller numbers;
- audible metronome clicks and Web MIDI Start/Clock/Stop output at Sync Ratio;
- configurable MIDI output latency and program-number display base.

## Explicit exceptions

Exceptions remain visible in the inventory rather than being disguised as
passes. They include legacy registration/Core MIDI/virtual-port setup, browser-
owned MIDI setup and Quit, the manual's own unavailable Undo/external-clock
items, browser-controlled background delivery, and obsolete zoom animation.

Two product decisions account for the remaining musical exceptions:

- **Sound Choice is excluded.** Each sequencer stream instead owns its own
  color-coded built-in synth. The Sound Choice Input Control key is consumed
  safely but does not alter project state.
- **Standard MIDI import and imported Sequence playback are excluded.** Movie
  capture and deterministic `.mid` export remain implemented. Sequence Play
  Enable, Sequence Snapshot state/persistence, and Sync-Restarts-Sequence
  therefore have no product target.

## Verification checkpoint

- Product suite: **758 tests across 62 files**.
- Coverage: **100% statements, branches, functions, and lines** for the included
  engine/state surface.
- Manual audit: **184 tests; 167 passed, 17 skipped, zero failures**.
- Typecheck and both production builds are part of the handoff gate documented
  in [`NEXT_STEPS.md`](./NEXT_STEPS.md).
