# Cyclic Random Commands — Dependency Map and Implementation Plan

The Cyclic Editor visual delta is tracked in
`VISUAL_AUDIT_AND_THEMING.md`; this document remains the behavior authority.

**Source of truth:** M 2.7 manual, Chapter 7 (Note Order), Chapter 21
(Pattern menu), and Chapter 22 (`Don't Scramble Rests`).

**Implementation status:** Complete as of 2026-07-30. All acceptance criteria
below are implemented and covered by the current 672-test, 100%-coverage suite.

## Manual behavior

M treats a Pattern as two parallel lists of steps:

- **Original** is the list visible in the Pattern Editor.
- **Scrambled** is the stored, repeating copy used by Cyclic Random playback.

The Pattern menu supplies three operations over a selected Pattern or Region:

| Command | Whole Pattern | Region |
| --- | --- | --- |
| **ReScramble** | Generate a new Cyclic Random ordering without changing Original. | Reorder the selected part of Scrambled, leaving both Original and the rest of Scrambled unchanged. |
| **Original → Scrambled** | Copy Original to Scrambled. | Copy corresponding Original steps into the selected part of Scrambled. |
| **Swap Scrambled and Original** | Exchange the two lists. | Exchange corresponding Original and Scrambled steps only inside the selected region. |

The manual calls Scrambled a stored “copy” of Original. Consequently it must be
Pattern-owned musical material, not a transient Voice-owned permutation.

## Historical mismatch (resolved)

Before this work, `Pattern` stored only `steps`. At playback start, `planner.ts` created
a permutation in each `VoiceCursor` from `project.seed + voiceIndex`. This has
four consequences, all now resolved:

1. The scramble cannot be inspected or changed by a Pattern command.
2. Two Voices reading the same Pattern can receive different scrambles.
3. ReScramble cannot take effect during playback without replacing a cursor.
4. Swap cannot expose the scrambled material in the Pattern Editor.

## Target data flow

```text
Pattern.steps ----------> Original branch ----\
                                               \
Pattern.scrambledSteps -> Cyclic branch --------> Note Order mixer -> output
                                               /
runtime RNG ------------> Utterly Random branch
```

Each Pattern will store:

```ts
steps: StepEvent[];
scrambledSteps: StepEvent[];
scrambleGeneration: number;
```

The generation counter makes repeated ReScramble operations different while
remaining reproducible from saved document state. A shuffle seed is derived
from the project seed, Pattern identity, and generation rather than from
playback time.

## Dependency map

### Document model and defaults

- `src/engine/types.ts`: add Pattern-owned scrambled material and generation.
- `src/engine/project.ts`: create a detached initial scrambled list.
- Pattern fixtures throughout the tests: supply or derive the new fields.

### Pure commands

- `src/engine/patterncmd.ts`: add pure Pattern-level implementations of
  ReScramble, Original → Scrambled, and Swap.
- Commands must honor the existing Region convention: `null` means the whole
  Pattern, endpoints are inclusive, reversed endpoints are accepted, and spans
  are clamped to existing material.
- `src/engine/patterncmd.test.ts`: quote and pin every relevant manual claim,
  including immutability, outside-region stability, chords, rests, one-step
  regions, and involution of Swap.

### Playback

- `src/engine/planner.ts`: read Original and Scrambled lists directly.
- Remove `VoiceCursor.cyclicOrder` and its output-length repair logic.
- Keep `makeCyclicOrder` only as a pure shuffle helper if still useful.
- `src/engine/planner.test.ts`: prove shared Pattern ownership, live
  ReScramble visibility, and correct Original/Cyclic/Utterly sources.

### Store and editing

- `src/state/store.ts`: add a Pattern-level command action.
- Every ordinary Pattern edit must leave Original and Scrambled structurally
  coherent. The first implementation regenerates Scrambled after an edit to
  Original; explicit scramble commands bypass that automatic regeneration.
- Normalize Output Length after any length-changing operation.
- `src/state/store.test.ts`: cover the action and every editing route that can
  change Pattern material.

### Interface

- `src/ui/PatternEditor.tsx`: add the three commands to the existing Pattern
  pull-down. The right-click menu inherits them from the same item list.
- Commands operate on the current Pattern or selected Region.

### Persistence and snapshots

- Snapshots require no change: by design they store control positions, not
  Pattern material.
- Future JSON save/load must serialize `scrambledSteps` and
  `scrambleGeneration`.

### `Don't Scramble Rests`

The manual’s option preserves the positions of rests whenever a reordering
operation occurs. It is a related follow-up, not a prerequisite for exposing
the three commands. The shuffle helper should nevertheless accept a
`preserveRests` option now so the later toggle does not require another command
redesign.

## TDD sequence

1. Write failing default-model and pure-command tests.
2. Add the Pattern fields and pure command implementation.
3. Write failing planner tests and migrate playback off cursor permutations.
4. Write failing store tests for Pattern-level commands and edit maintenance.
5. Implement store actions and automatic scramble maintenance.
6. Wire the menu commands.
7. Run targeted tests, full 100% coverage, typecheck, production build, and
   single-file build.

## Acceptance criteria

- ReScramble changes Scrambled and never Original.
- Original → Scrambled creates detached matching steps.
- Swap exchanges the selected corresponding material and is its own inverse.
- Regions never affect steps outside their inclusive span.
- Cyclic playback reads the Pattern’s stored Scrambled list.
- Two Voices reading one Pattern share that same list.
- A command issued during playback is visible on a subsequent planner window.
- Existing Pattern editing cannot leave incompatible list lengths.
- Engine and state coverage remains 100%.
