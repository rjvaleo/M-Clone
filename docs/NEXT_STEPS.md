# Technical Completion Plan

**Updated:** 2026-08-02  
**Current version:** 0.8.0-alpha

The 0.8.0-alpha build is published from the `v0.8.0-alpha` tag. Everything in
this plan below the green checkpoint is 1.0 work; alpha is a distribution stage,
not a claim that Classic is complete. Per-release scope, exclusions, and known
limitations live in [`../CHANGELOG.md`](../CHANGELOG.md).

The manual gap-closing plan is complete. Work was executed TDD-first: existing
partial/unwired behavior, then live-input/controller capabilities, then
documentation and release verification. Standard MIDI import/imported Sequence
playback and Sound Choice remain deliberate exclusions.

## Green checkpoint

- **758 tests across 62 files**.
- **100% statements, branches, functions, and lines** across included engine
  and state modules.
- **184 manual-conformance tests: 167 passed, 17 explicit skips**.
- Versioned `.mclone` project save/load, Movie capture, and deterministic
  format-1 Standard MIDI export.
- Web MIDI output, multi-port lifecycle, live input assignment/routing,
  recording, Input Control, controller conducting, metronome, and MIDI Clock.
- Typecheck, normal production build, and single-file build are required before
  handoff.
- Resolved browser/tooling versions and architecture boundaries are recorded in
  [`TECH_STACK.md`](./TECH_STACK.md).

## Completed sequence

1. ✅ MIDI reliability phases 1–3.
2. ✅ Versioned project document and File commands.
3. ✅ Snapshot, Slideshow, and Phrasing/Legato behavior.
4. ✅ Movie recording and Standard MIDI export.
5. ✅ All retained gaps in existing manual functionality.
6. ✅ Live MIDI input, recording, routing, Input Control, Mouse/Step Advance,
   controller conducting, metronome, clock, and assignment UI.
7. ⛔ Sound Choice and Standard MIDI import/Sequence playback intentionally
   excluded from Classic Web.

## Next local implementation frontier

Proceed in this order:

### 1. Complete the M Classic audio rack

The current four-stream subtractive synth is a capable color-coded monitor, not
the approved role-specific rack. Implement the four lightweight Classic engines
defined in [`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md): drum sampler,
monophonic bass, lead, and chord/pad, followed by the basic stereo mixer,
reverb, and delay. Preserve one patch per sequencer stream.

### 2. Remove fixed-four assumptions from the core

Make framework-independent project, planner, event, MIDI, and document code
accept a configured 1–16 Voice count. Classic UI remains four Voices; Studio
will expose eight. Start with tests that run identical planning/routing traces
at 1, 4, 8, and 16 Voices.

### 3. Classic release hardening

- Long-session CPU/memory and asset-loading tests.
- Save/load migration fixtures and failure recovery.
- Accessibility/keyboard audit for dense controls.
- Remove or clearly defer every remaining visible placeholder.

### 4. Hardware/browser certification

This is a parallel release-verification lane rather than the next purely local
coding task:

- Exercise the 16× input/output assignment matrix with representative USB and
  virtual MIDI devices.
- Verify reconnect, device replacement, permission denial, tab suspension, and
  foreground recovery in each supported browser.
- Measure clock jitter, note latency, and configured latency compensation on
  real hardware; publish the supported-browser/device matrix.
- Add any reproducible failures as red automated adapter/runtime tests before
  changing implementation.

### 5. Native desktop foundation

After the Classic Web release gate, follow
[`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md) for native monotonic timing,
audio/MIDI device adapters, packaging, signing, and host integration.

## Working rules

- TDD: red focused test, implementation, focused green, full suite, 100%
  coverage, typecheck, and both builds.
- Keep manual capability dispositions honest; do not revive excluded systems
  without a concrete product workflow.
- The current layout is accepted. Fix visual defects that hide data or break
  controls, but do not start another broad fidelity pass before release
  hardening.
