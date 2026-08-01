# Midi View

Implemented 2026-07-31 as a compact diagnostic tracker for M-Clone's four
generated Voices. The current UI is the initial delivered event-list design.

## Capture point

Midi View records planner notes after the runtime has submitted the corresponding
explicit event batch to Web Audio and Web MIDI. Each generated note is
captured once regardless of enabled sinks, without running a second planner or
altering musical RNG state. Editor Sound audition notes are excluded because
they bypass the four generative streams.

Midi View is UI telemetry, not a wire-level timing analyzer. The output-first
ordering ensures React work cannot delay the batch it displays. For clock
domains, lifecycle ordering, device cancellation, and measurement procedures,
see [`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md).

## Display

The window contains a timestamp column and four fixed, globally color-coded
stream columns. Simultaneous events share a row and chords stack inside their
Voice cell. Each message shows:

- planner timestamp;
- Note On or Note Off;
- note name and MIDI number;
- velocity;
- output MIDI channel;
- planned duration for Note On messages.

The compact 454px window uses a shared 60px time-column measurement for its
header, rows, and background dividers. Each stream message lays its six fields
out as two rows of three, keeping Note On duration and the other metadata inside
the lane rather than allowing it to overlap an adjacent Voice.

Midi View shares the application's panel, control, border, and selected-state
palette in both light and dark modes. Only its monospaced event typography and
four Voice colors distinguish it from other modules; it no longer uses a
separate always-black visual theme.

**Follow** keeps the scrollable history pinned to the newest rows and can be
turned off for inspection. **Clear** resets the history. Events remain sorted,
stable at equal timestamps, and bounded to 1,000 messages.

The later animated absolute-time timeline, moving columns, fixed PLAY line,
tempo-scaled 16th-note ruler, and Pattern position/length display were removed
when Midi View was restored to its initial delivered design.

## Tests

Pure tests cover conversion of planned notes into display Note On/Off rows, note
naming, stable chronological ordering, simultaneous row grouping, chord cells,
history bounds, and store record/clear actions. Runtime ordering is separately
tested with fake clocks and MIDI ports. Browser layout verification checks that
message and cell `scrollWidth` never exceed `clientWidth` in both themes.
