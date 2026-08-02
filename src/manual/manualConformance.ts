export type ConformanceResult = "pass" | "partial" | "fail" | "not-applicable";

export type ManualCapability = {
  id: string;
  chapter: string;
  pages: string;
  behavior: string;
  result: ConformanceResult;
  evidence: string;
};

const item = (
  chapter: string,
  pages: string,
  id: string,
  behavior: string,
  result: ConformanceResult,
  evidence: string,
): ManualCapability => ({ chapter, pages, id, behavior, result, evidence });

/**
 * Executable inventory of the behavior described by M 2.7, chapters 2-22 and
 * Appendix A. Tutorial repetitions are represented by the canonical reference
 * entry rather than counted twice. Legacy host/registration requirements are
 * retained as explicit compatibility exceptions.
 */
export const MANUAL_CAPABILITIES: readonly ManualCapability[] = [
  item("1", "7", "host.registration", "Serial-number registration and demo-mode save restrictions", "not-applicable", "Browser product has no legacy registration system."),
  item("1", "7", "host.core-midi", "Use OS X Core MIDI as the host I/O system", "not-applicable", "Web MIDI replaces Core MIDI in the browser edition."),

  item("2", "8-14", "desktop.six-main-windows", "Expose Patterns, Conducting, Variables, Cyclic Variables, Midi, and Snapshot windows simultaneously", "pass", "Unified.tsx renders the six permanent modules."),
  item("2", "10,145", "variables.six-positions", "Give each non-Sound-Choice Variable six selectable Positions", "pass", "variables.ts and project state use six Positions."),
  item("2", "10,149", "sound-choice.sixteen-positions", "Give Sound Choice sixteen selectable Positions", "not-applicable", "Sound Choice was explicitly removed from this product's scope; each sequencer stream instead owns a color-coded built-in synth."),
  item("2", "10-11,150", "windows.open-editors", "Open Variable edit windows by double-click or menu", "pass", "Unified.tsx/App.tsx share the auxiliary-window registry."),
  item("2", "11,150", "windows.close-editors", "Close individual Variable edit windows", "pass", "Auxiliary windows have close controls."),
  item("2", "11,181", "windows.move", "Move all modules by dragging their title area", "pass", "useDraggable and workspace state implement movement."),
  item("2", "11,181", "windows.raise", "Bring a window forward by title click, Windows menu, or command-click", "pass", "Pointer focus, Windows menu selection, and action-suppressing Command-click focus are wired across every draggable module."),
  item("2", "11,181", "windows.close-all-editors", "Close all open edit windows from Windows menu", "pass", "The Windows menu has a wired Close Edit Windows command."),
  item("2", "11-14", "controls.buttons", "Support momentary and toggle buttons", "pass", "React controls and state actions implement both control types."),
  item("2", "12,145", "controls.conducting-arrow", "Enable, disable, and choose axis/direction for Conducting Arrows", "pass", "ConductingArrow and conductor state are tested."),
  item("2", "12-13", "controls.numerical", "Edit bounded numerical controls by direct manipulation", "pass", "All numeric inputs share upper/lower stepping, horizontal drag, bounded step alignment, and Shift-copy behavior."),
  item("2", "14,151", "controls.slider", "Set sliders from handles or associated numericals", "pass", "Density, Velocity Range, and Note Order editors expose both paths."),

  item("3,19", "15-16,167-171", "midi.assignment.devices", "Map each M Input and Output Channel to a MIDI device and channel", "pass", "The MIDI setup has sixteen persisted input/output rows; input events and output events are rechannelized through their assigned physical devices."),
  item("3,19", "15-16,168", "midi.assignment.virtual-ports", "Expose the manual's virtual to/from M ports", "not-applicable", "Browser Web MIDI cannot create OS-level virtual ports."),
  item("19", "168-169", "midi.assignment.program-base", "Choose whether each output channel displays programs as 0-127 or 1-128", "pass", "The persisted display-base selector changes program numericals without changing transmitted 0-127 program bytes."),
  item("19", "169-170", "midi.assignment.channel-mode", "Send Omni On/Off, Local Control On/Off, System Reset, and All Notes Off", "pass", "The MIDI setup exposes all six commands and MidiSink byte-level tests cover Omni, Local Control, All Notes Off, and System Reset."),
  item("19", "170", "midi.assignment.panic", "Send a Note Off for every pitch on selected channels", "pass", "WebMidiSink panic covers active/controller cleanup; runtime panic is tested."),
  item("19", "170", "midi.assignment.midi-conduct", "Assign two controller numbers to horizontal and vertical MIDI Conducting", "pass", "Persisted X/Y controller numericals route incoming CC values to the Baton."),
  item("19", "171", "midi.assignment.latency", "Apply a persisted 0-999ms MIDI output latency", "pass", "MidiSink adds the persisted bounded latency to scheduled Web MIDI timestamps."),

  item("4,13", "32-41,129", "input.source-channel", "Filter each Voice input by source channel 1-16 or All", "pass", "Physical device/channel assignments map into M Input channels, then each Voice's persisted Src filter is applied."),
  item("4,13", "33-35,129-130", "input.use-disable", "Ignore incoming MIDI in Disable mode", "pass", "The live router excludes disabled Voices."),
  item("4,13", "35-40,129-132", "input.use-record", "Record incoming MIDI into the selected Pattern", "pass", "Selected live MIDI input records through the Pattern's active chord/insertion modes and MIDI Edit range."),
  item("10,13", "110-115,130", "input.use-control", "Drive the Input Control System from incoming notes", "pass", "The Control Use mode drives the Appendix B one-step/two-step decoder."),
  item("11,13", "117,130", "input.use-keyboard-transpose", "Transpose a Voice from incoming notes relative to C3", "pass", "Keyboard Transpose maps MIDI 60 to zero and applies semitone offsets per routed Voice."),
  item("13", "130", "input.use-echo-map", "Rechannelize incoming MIDI through an Echo Map", "pass", "The 16-channel Echo Map rechannelizes live notes to every selected output channel."),
  item("4,13", "33-35,130", "input.echo-orchestration", "Echo incoming notes through the Voice's current Orchestration", "pass", "Echo-Thru sends routed live notes through the Voice's active Orchestration channels."),
  item("4,13", "36-40,131", "record.single", "Record incoming events as single-note steps", "pass", "Single mode records and advances on every Note On."),
  item("4,13", "36-40,131", "record.chord", "Record contemporaneous notes as chord steps", "pass", "Chord mode accumulates held notes and commits the complete chord when released."),
  item("4,13", "36-40,131", "record.build", "Build and toggle notes in a sustained evolving chord", "pass", "Build mode inserts the first note, accumulates subsequent held notes into that step, and advances after release."),
  item("4,13", "36-40,131-132", "record.insert", "Insert recorded steps at the MIDI Edit Counter", "pass", "Live recording inserts at the shared MIDI Edit Counter within Pattern Size."),
  item("4,13", "36-40,132", "record.replace", "Replace the step at the MIDI Edit Counter", "pass", "Live recording replaces the counter step."),
  item("4,13", "36-40,132", "record.overdub", "Add recorded notes to the current step", "pass", "Live recording unions incoming pitches with the counter step."),
  item("4,13", "39-40,132", "record.drum-machine", "Make the MIDI Edit Counter follow Pattern output while recording", "pass", "The planner reports every played step and Drum Machine Record follows its Voice's current output step."),
  item("13", "130-132", "patterns.select", "Select Patterns and Option-click their three Record Mode icons", "pass", "Unified.tsx implements selection, double-click editing, and Option-click mode changes."),

  item("6,13", "58-61,132", "voice.play-enable", "Mute or enable each Voice independently", "pass", "Voice playEnabled gates planning and is snapshot-aware."),
  item("11,13", "116,132", "voice.mouse-advance", "Gate enabled Voices from mouse motion plus Caps Lock or Command-Option", "pass", "Enabled Mouse Advance Voices leave the regular planner and advance from gated mouse motion with speed-derived velocity."),
  item("6,13", "61-63,133", "voice.output-length", "Play only the selected number of Pattern steps, including zero as mute", "pass", "Planner and Pattern state use outputLength."),
  item("5,13,A", "57,133,187", "voice.output-length-option", "Option-edit Output Length to permanently trim or append rest steps", "pass", "Pattern command/store tests cover permanent resizing."),
  item("6,13", "63-65,133-134", "voice.time-base", "Apply numerator and all numeric denominator Time Base values", "pass", "Transport/timemap tests cover the complete numeric denominator set."),
  item("10,13", "114,133", "voice.time-base-step-advance", "Support sa Time Base for MIDI Step Advance", "pass", "The sa denominator silences clocked planning and Appendix B Step Advance keys advance enabled sa Voices."),
  item("6,13", "63-65,133-134", "voice.phase", "Delay a Voice from Start or Sync by M ticks", "pass", "Phase is persisted, snapshotted, planned, and recorded."),

  item("5,14", "42-45,135", "editor.open", "Open the selected Pattern in the Pattern Editor", "pass", "Pattern Select double-click and menu opening are wired."),
  item("14", "135", "editor.resize", "Resize the Pattern Editor with its size box", "pass", "PatternEditor owns the documented resize exception."),
  item("5,14,A", "43,135,187", "editor.view", "Choose one edited Voice and Shift-click additional background Voices", "pass", "Pattern Editor supports the View selector and overlays."),
  item("5,14", "46-48,135-136", "editor.grid-toggle", "Click or drag to add and remove notes/chords in the chromatic step grid", "pass", "Editor/store tests cover drawing, erasing, chords, and extension."),
  item("14", "136", "editor.extend-with-rests", "Click beyond Pattern end to add a note and intermediate rests", "pass", "Editor store action extends with rest steps."),
  item("14", "136", "editor.reference-keyboards", "Audition pitches from either reference keyboard through the Voice output", "pass", "Pattern Editor audition uses the runtime scheduler."),
  item("14", "136-137", "editor.pitch-scroll", "Scroll the visible pitch range by semitone or octave", "pass", "Pattern Editor exposes semitone and octave scroll controls."),
  item("14", "137", "editor.step-scroll", "Scroll Pattern steps by arrow, page, or draggable thumb", "pass", "Pattern Editor supports arrow repeat, page, and thumb navigation."),
  item("5,14", "46-50,137-138", "editor.select-region", "Create pointwise or ranged selections", "pass", "Region state distinguishes point and ranged selection."),
  item("5,14", "48-50,138", "editor.eraser", "Change clicked or selected steps to rests", "pass", "Eraser uses Change to Rests semantics."),
  item("5,14", "48-50,138", "editor.plunger", "Insert a blank step before the target", "pass", "Editor tool action inserts a rest."),
  item("5,14", "48-50,138", "editor.scissors", "Delete clicked or selected steps", "pass", "Editor tool action deletes the selected span."),
  item("5,14", "51-54,138-139", "editor.midi-range", "Set the step range affected by incoming MIDI", "pass", "The Pattern Editor's shared range bounds live recording and counter wrap."),
  item("5,14", "51-54,139", "editor.midi-counter", "Place and automatically advance the next MIDI edit position", "pass", "The shared counter is draggable, consumed by live recording, advances/wraps, and follows Drum mode output."),
  item("5,14,A", "44,139,188", "editor.sound", "Audition edits, counter steps, legend steps, and reference keys at configured velocity", "pass", "Audition paths and ~ / comma keyboard equivalents are wired."),
  item("14,22", "139,185", "editor.sound-while-playing", "Gate Editor Sound while transport plays using the option", "pass", "Pattern Editor audition requires its local enable and, during playback, Editor Sound While Playing."),
  item("14", "140", "editor.record-mode-controls", "Edit Chord, Insertion, and Drum Machine modes", "pass", "PatternEditor and Patterns module update stored modes."),
  item("14", "140", "editor.pattern-size", "Set Pattern maximum size without truncating existing material", "pass", "Editor constraints and tests cover the 999-step ceiling."),

  item("7,16", "66-68,145-146", "variables.activate", "Keep one active Position per Variable and select it directly", "pass", "Variable positions drive planner/state."),
  item("8,16,A", "95,146,187", "variables.copy-swap", "Drag to swap Positions and Option-drag to copy", "pass", "Every in-scope Variable Position supports drag-to-swap and Option/Alt-drag-to-copy with deep-cloned values."),
  item("17,A", "150-151,187", "variables.mark", "Mark/unmark a Position and optionally lock marked Positions", "pass", "Pulling down on an editor Position toggles its persisted asterisk mark; the lock option protects its contents and transfers."),
  item("17,A", "150-151,187", "variables.edit-active", "Option-select an edit Position to activate it; Shift-Option quantizes activation", "pass", "Editor Position selection is independent from Active Position; Option activates it and Shift-Option schedules activation at Snapshot quantization."),
  item("17,A", "151,187", "variables.voice-copy-swap", "Copy or swap per-Voice editor settings by dragging Voice numbers", "pass", "Voice labels in the Variable editors, including Transposition and Time Distortion, drag-swap and Option/Alt-drag-copy."),
  item("7,16,17", "70-71,147,151", "variable.density", "Apply and edit per-Voice random note density percentages", "pass", "Density transforms and editor are tested."),
  item("7,16,17", "71-72,147,152", "variable.velocity-range", "Edit low/high velocity ranges and map Accent levels through them", "pass", "Velocity/Accent mapping and range editor are tested."),
  item("7,16,17", "87-88,147,152-153", "variable.note-order", "Mix Original, Cyclic Random, and Utterly Random with two movable boundaries", "pass", "Transform tests and the two-boundary editor pin all three regions."),
  item("7,16,17", "68-70,147,153", "variable.transpose", "Transpose each Voice by note and octave relative to C3", "pass", "Transpose presentation and planner behavior are tested."),
  item("7,16,17", "82-87,147,153-154", "variable.time-distortion", "Draw, clear, size, and apply per-Voice breakpoint time maps", "pass", "timemap and planner tests cover audible remapping."),
  item("7,16", "88-89,146", "variable.pattern-group", "Store six independent banks of four Patterns and Pattern-window settings", "pass", "The project holds 24 Patterns in six banks; group changes remap four Voices and restore banked Output Length, Time Base, Phase, and record modes, with group labels in both windows."),
  item("7,16,17", "89-90,149,155", "variable.orchestration", "Assign any of 16 Output Channels independently to each Voice", "pass", "Four-by-six Orchestration matrices route Web MIDI output."),
  item("7,16", "90-91,149", "variable.sound-choice", "Store sixteen program-change presets across sixteen Output Channels", "not-applicable", "The Sound Choice subsystem was explicitly skipped in favor of one editable built-in synth per sequencer stream."),
  item("7,16,17", "72-82,147-148,155-156", "cyclic.editor-switching", "Edit Accent, Legato, and Rhythm Variables and all six Positions in one Cyclic Editor", "pass", "Classic/Modern Cyclic Editor and selection tests cover switching."),
  item("7,17", "72-82,155-156", "cyclic.grid", "Edit 1-16 step cycles with fixed levels and vertical random level ranges", "pass", "cyclic.ts and UI selection/layout tests cover levels, ranges, and lengths."),
  item("7,17", "76-79,156", "cyclic.rhythm-values", "Map Rhythm levels to Time Base multiples", "pass", "Cyclic value tables feed planner onset timing."),
  item("7,17", "79-82,156", "cyclic.legato-values", "Map Legato levels to onset-interval sustain percentages, including overlap", "pass", "Planner Legato tests cover percentage sustain above and below 100%."),
  item("7,17", "71-76,156", "cyclic.accent-values", "Use Accent levels 0-4 with level 0 silent and levels 1-4 through Velocity Range", "pass", "variables/planner tests pin the mapping."),

  item("8,15", "92-100,141-144", "transport.start", "Start from the beginning when stopped and resume when paused", "pass", "Transport/runtime tests distinguish Start, Resume, and Stop."),
  item("8,15", "92-100,141", "transport.stop", "Stop output and reset playback state", "pass", "Runtime clears queues and panics on Stop."),
  item("8,15", "92-100,141", "transport.pause", "Pause and resume at the same musical position", "pass", "Runtime continuity tests cover pause origin shifting."),
  item("8,15", "92-100,141", "transport.sync", "Reset Voices and Cyclic Variables to their first step", "pass", "Sync resets planner cursors and queued output."),
  item("12,15", "120-122,142", "transport.movie", "Arm before Start, capture output, and finalize a Movie", "pass", "movie.ts/store tests cover arm, capture, Stop, and replacement semantics."),
  item("12,15", "124-128,142", "transport.sequence-enable", "Mute/unmute an imported Sequence without stopping its position", "not-applicable", "Imported Sequence playback is intentionally out of scope because Standard MIDI import was explicitly removed."),
  item("8,15", "92-100,142", "transport.tempo", "Set tempo directly and conduct it within a range whose midpoint becomes current tempo", "pass", "Conductor/store tests cover bounded tempo and range normalization."),
  item("15", "143", "transport.sync-ratio", "Set outgoing metronome/clock ratio or incoming-clock ratio", "pass", "The outgoing ratio drives both metronome and 24-PPQN MIDI-clock intervals; the obsolete incoming-clock mode remains a displayed legacy direction."),
  item("8,15", "92-100,143", "conducting.grid", "Move one Baton to select enabled Variable Positions along either axis/direction", "pass", "conductor.ts maps the normalized Baton to armed arrows."),
  item("8,A", "98-100,187", "conducting.continuous", "Continuously interpolate Velocity Range and Legato while dragging", "pass", "Pulling either supported Conducting Arrow opens a temporary four-Voice control panel; enabled Voice directions shift the active Velocity Range continuously or scale Legato from 0.25x to 4x without selecting another Position."),
  item("8,15", "98-100,143-144", "conducting.robot", "Move the Baton automatically within configured X/Y ranges and Time Base", "pass", "Robot conductor movement and scheduling are tested."),
  item("8,A", "95,187", "conducting.option-clear", "Option-click the grid to clear Continuous Conducting effect", "pass", "Option/Alt-click restores active Velocity Range and neutral Legato while retaining the enabled Continuous Conducting controls for the next drag."),
  item("8,A", "95-98,187", "conducting.quantized", "Shift-conduct at Snapshot quantization and record it in Slideshows", "pass", "Shift-grid gestures schedule the atomic conducting update at Snapshot quantization and record armed Variable/Cyclic choices into an active Slideshow."),

  item("9,18", "101-105,157", "snapshot.hold-do", "Collect selected controls during Hold and apply them together on Do", "pass", "snapshot/store tests cover partial deferred control sets."),
  item("9,18", "102-106,157-158", "snapshot.store-recall", "Store and recall 26 partial Snapshots A-Z", "pass", "Snapshot state and keyboard controls support A-Z."),
  item("9,18", "102-106,157", "snapshot.conducting", "Conduct the first six stored Snapshots from the Snapshot Conducting Arrow", "pass", "Baton movement resolves the arrow axis to A-F, executes stored Snapshots once per location, and arms Restore."),
  item("9,18", "102-106,157-158", "snapshot.quantization", "Quantize Snapshot, Sync, Slideshow, and shifted Variable actions", "pass", "One shared rhythmic gesture path covers Snapshot execution/conducting, Sync, Slideshow start, Hold/Do storage, shifted Variable activation, and shifted conducting."),
  item("9,18", "102-106,157-158", "snapshot.contents", "Capture Variable positions/arrows and supported Pattern-window controls", "pass", "snapshot.ts has explicit partial control keys."),
  item("18", "158", "snapshot.sequence", "Capture Sequence Play Enable in a Snapshot", "not-applicable", "There is no imported Sequence state to capture; that subsystem is intentionally out of scope."),
  item("18", "158", "snapshot.current-mark", "Mark the last stored or executed Snapshot", "pass", "currentSnapshot drives the UI sun mark."),
  item("18", "159", "snapshot.edit", "Edit membership of the current Snapshot and store it to any slot", "pass", "Edit Snapshot mode is implemented and tested."),
  item("18", "159", "snapshot.restore", "Undo changes caused by the most recently executed Snapshot", "pass", "restorePoint and restoreFromSnapshot are implemented."),
  item("18", "159", "snapshot.blink-all", "Select every supported storable control for Snapshot creation", "pass", "blinkEverything builds the supported control-key set."),
  item("9,18", "106-109,159-161", "slideshow.record", "Record Snapshot and quantized Variable actions with their relative timing", "pass", "slideshow/store tests cover action recording and Record Wait."),
  item("9,18", "106-109,160", "slideshow.play", "Play nine Slideshows with quantized start and current Snapshot definitions", "pass", "Slideshow playback resolves stored Snapshot indices at execution."),
  item("9,18", "106-109,160-161", "slideshow.stop-pause", "Stop or pause/resume Slideshow recording and playback", "pass", "Slideshow transport tests cover stop and paused timing."),
  item("9,18", "106-109,161", "slideshow.loop", "Add/remove or record a Slideshow loop point", "pass", "Loop-point operations and keyboard controls are tested."),

  item("10", "110-115,190", "input-control.enable", "Enable the keyboard Input Control System per Voice", "pass", "The Patterns Use control exposes C and routes the selected source to Input Control."),
  item("10,B", "110-115,190", "input-control.transport", "Start, Stop, Sync, and accelerate/decelerate/freeze/tap tempo from mapped notes", "pass", "The Appendix B map dispatches transport, gradual tempo, Tap Tempo, Tap Conduct, and Freeze keys."),
  item("10,B", "110-115,190", "input-control.patterns", "Mute, clear, and Step Advance individual/all Patterns from mapped notes", "pass", "Appendix B Voice toggles, Clear keys, paired Voice advance keys, and all-sa advance keys are wired."),
  item("10,B", "110-115,190", "input-control.variables", "Select Pattern Group, Order, Sound, Orchestration, Transposition, Velocity, Density, Rhythm, Accent, and Legato", "pass", "Black-key codes and numbered white keys select every in-scope Variable and Pattern Group; Sound Choice remains explicitly excluded."),
  item("10,B", "110-115,190", "input-control.snapshots", "Execute/edit Snapshots and record/play/stop Slideshows from mapped notes", "pass", "Appendix B Snapshot and Slideshow one/two-step commands dispatch to the existing tested systems."),
  item("10,B", "110-115,190", "input-control.tap-conduct", "Select Variable Positions by played note and optionally scale velocity", "pass", "Tap Conduct starts/taps tempo and the Tap Affects Velocity option scales Voice intensity from incoming velocity."),
  item("11", "118-119", "performance.play-along", "Echo/rechannelize live playing while M runs", "pass", "Echo Map and Echo-Thru monitor live input through selected output channels while playback continues."),

  item("12,19", "120-122,167", "file.movie-export", "Save a completed Movie as a Standard MIDI File", "pass", "Deterministic type-1 SMF export and download are tested."),
  item("12,19", "122-127,163-166", "file.midi-import-pattern", "Import selected MIDI channels into Patterns with chord, timing, rest, and quantization choices", "not-applicable", "Standard MIDI import was explicitly removed from product scope; completed Movies still export as .mid."),
  item("12,19", "124-128,163-166", "file.midi-import-sequence", "Import filtered MIDI channels faithfully as an independent Sequence", "not-applicable", "Standard MIDI import and its independent Sequence mode were explicitly removed from product scope."),
  item("12,19", "128,166", "file.sequence-persist", "Save and reopen an imported Sequence with the project", "not-applicable", "Sequence persistence is unnecessary because imported Sequence playback is intentionally excluded."),
  item("19", "162-163", "file.new", "Reset to a startup state", "pass", "New loads the machine-local Startup State while replacing Pattern contents and Time Maps with fresh defaults."),
  item("19", "162-163", "file.open", "Open one project at a time and replace current work", "pass", "Defensive ProjectDocumentV2 import replaces state."),
  item("19", "166", "file.save", "Save to the current project name or behave as Save As when unnamed", "pass", "fileCommands and title tests cover the save paths."),
  item("19", "166", "file.save-as", "Save the project under an explicit new name", "pass", "The app-owned naming dialog and .mclone download are tested."),
  item("19", "167", "file.startup-state", "Persist current controls as the New/launch Startup State, excluding Patterns and Time Maps", "pass", "Save State As Startup persists locally; launch/New merge its screen state onto fresh Pattern contents and Time Maps."),
  item("19", "163", "file.unsaved-guard", "Offer to save unsaved work before New/Open", "pass", "New/Open offer Save, Discard, and Cancel; untitled saves resume the pending action after the app-owned filename dialog."),
  item("19", "167-171", "file.midi-assignment", "Open the full Input/Output MIDI Assignment window", "pass", "MIDI Setup exposes the full sixteen-row input/output matrix plus program base, latency, conducting CCs, and channel-mode commands."),
  item("19", "167", "file.midi-setup", "Open host MIDI system configuration", "not-applicable", "Browser security model owns MIDI permission/setup."),
  item("19", "162", "file.quit", "Quit the application", "not-applicable", "A browser tab does not own application termination."),

  item("20", "172-173", "edit.multi-select", "Select arbitrary multiple Patterns and apply Edit commands", "pass", "Shift-click builds an arbitrary Pattern selection and whole-Pattern Edit/Pattern commands fan out to every selected Pattern."),
  item("5,20", "56,172-173", "edit.cut", "Copy then delete selected Pattern or Region steps", "pass", "patterncmd/store tests cover Cut and detached clipboard data."),
  item("5,20", "56,172-173", "edit.copy", "Copy selected Pattern or Region without deletion", "pass", "copyRegion is immutable and tested."),
  item("5,20", "56,173", "edit.paste", "Paste Patterns including settings or Regions with truncate/rest-fill semantics", "pass", "Region paste retains its tested truncate/rest-fill behavior; whole-Pattern paste clones material, scramble, size/output, and record-mode settings while preserving destination identity."),
  item("5,20", "56,174", "edit.paste-notes", "Paste only note information without destination settings", "pass", "pasteNotes preserves destination length/settings."),
  item("5,20", "56,174-175", "edit.insert-paste", "Insert all clipboard steps at a Region/point selection", "pass", "insertPaste and pointwise selection are tested."),
  item("5,20", "56,174", "edit.paste-at-end", "Append clipboard notes to an entire Pattern", "pass", "pasteAtEnd behavior shares the Insert Paste command id."),
  item("5,20", "56,173", "edit.clear", "Delete Pattern/Region steps and adjust Output Length", "pass", "clearSteps/store integration is tested."),
  item("5,20", "56,174", "edit.change-rests", "Replace notes with rests without deleting steps", "pass", "changeToRests is tested."),
  item("5,20", "56,174", "edit.fill-rests", "Fill to Pattern maximum size with rests", "pass", "fillWithRests is tested."),
  item("20", "175", "edit.erase-snapshot", "Erase the currently marked Snapshot and disable the command when none is marked", "pass", "patternMenus and store wire guarded Snapshot deletion."),
  item("5,20", "56", "edit.undo", "Undo Pattern editing", "not-applicable", "The manual explicitly says Undo is unimplemented; this build lists future Undo/Redo but does not claim parity."),

  item("21", "176", "menu.variables", "Open every Variable editor at its active Position", "pass", "Every in-scope Variable editor opens at its active Position; Pattern Group is edited in Patterns and Sound Choice is explicitly out of scope."),
  item("21", "176", "menu.voice-colors", "Choose four Voice colors and persist them in Startup State rather than projects", "pass", "Four color pickers persist as machine-local startup preferences and are deliberately excluded from project documents."),
  item("21", "177", "pattern.edit", "Open the selected Pattern Editor", "pass", "Pattern menu handler opens Pattern Editor."),
  item("5,21", "55,178", "pattern.transpose", "Permanently transpose Pattern/Region by half-step or octave in either direction", "pass", "transposeSteps clamps MIDI notes and is tested."),
  item("5,21", "55,178", "pattern.rescramble", "Generate a new deterministic Cyclic Random ordering", "pass", "reScramble and generation state are tested."),
  item("5,21", "55,178", "pattern.original-scrambled", "Copy Original order into the Scrambled list", "pass", "originalToScrambled is tested over Patterns and Regions."),
  item("5,21", "55,178", "pattern.swap-scrambled", "Swap Original and Scrambled lists", "pass", "swapScrambledAndOriginal is tested."),
  item("5,21", "55,178-179", "pattern.rotate-forward", "Move the first selected step to the end", "pass", "rotateForward is tested."),
  item("5,21", "55,178-179", "pattern.rotate-backward", "Move the last selected step to the beginning", "pass", "rotateBackward is tested."),
  item("5,21", "55,179", "pattern.reverse", "Reverse selected Pattern/Region steps", "pass", "reverseOrder is tested."),
  item("5,21", "55,179-180", "pattern.double-rests", "Insert one rest after each selected step and increase length", "pass", "doubleWithRests/store integration is tested."),
  item("5,21", "55,180", "pattern.triple-rests", "Insert two rests after each selected step and increase length", "pass", "tripleWithRests/store integration is tested."),
  item("5,21", "55,180", "pattern.eliminate-chords", "Expand chord pitches into ordered individual steps", "pass", "eliminateChords is tested."),
  item("5,21", "55,180", "pattern.eliminate-rests", "Delete rest steps from selected material", "pass", "eliminateRests is tested."),
  item("21", "181", "menu.windows-dynamic", "List open windows dynamically and bring a selected window forward", "pass", "App builds the Windows menu from the shared registry."),
  item("21,A", "181,187", "menu.windows-send-back", "Use Command-Option-number to send a main window to the back", "pass", "Command-Option-1 through 6 map to the permanent modules and assign a lower shared stacking index."),

  item("22", "182", "option.metronome", "Generate an audible metronome at the configured Sync Ratio", "pass", "The runtime schedules short Web Audio clicks at the configured outgoing ratio."),
  item("22", "183", "option.send-clock", "Send MIDI clock at the configured ratio", "pass", "The runtime sends Start, 24-PPQN Clock pulses, and Stop through selected Web MIDI outputs at the configured ratio and latency."),
  item("22", "183", "option.external-clock", "Drive M from external MIDI clock", "not-applicable", "The 2.7 manual itself says this feature is no longer available."),
  item("22", "183", "option.tap-velocity", "Scale all Voice and Sequence velocities from the last Tap Conduct key", "pass", "Tap Conduct velocity scales all in-scope Voice velocity ranges; imported Sequence playback is excluded."),
  item("22", "183", "option.keep-rests", "Preserve rest locations when scrambling", "pass", "Ordinary Pattern edits and explicit ReScramble pass the option through the deterministic scramble path."),
  item("22", "183", "option.slideshow-wait", "Delay Slideshow timing until its first event by default", "pass", "Slideshow Record Wait defaults on and is behavior-tested."),
  item("22", "183-184", "option.no-zoom", "Disable legacy window zoom animations", "not-applicable", "Browser windows open immediately and never draw the obsolete QuickDraw zoom rectangles."),
  item("22", "184", "option.sustain-rests", "Insert Pattern rests from sustain-pedal presses", "pass", "A routed sustain-pedal press records a rest and advances/wraps the MIDI Edit Counter."),
  item("22", "184", "option.midi-conduct", "Enable controller-driven Baton motion", "pass", "The option gates assigned horizontal/vertical CC messages into the shared conducting path."),
  item("22", "184", "option.second-order", "Preserve relative Variable transpositions under Keyboard Transpose", "pass", "Keyboard Transpose is live and the planner's tested Second Order path stacks per-Voice transpositions cumulatively."),
  item("22", "184-185", "option.no-cyclic-blink", "Disable Cyclic reset blinking", "pass", "Runtime cursor-wrap telemetry retriggers the per-Voice Cyclic reset pulse; No Cyclic Blinking suppresses that pulse."),
  item("22", "185", "option.sync-sequence", "Choose whether Sync restarts an imported Sequence", "not-applicable", "Sync-Restarts-Sequence has no target because imported Sequence playback is intentionally excluded."),
  item("22", "185", "option.editor-sound", "Allow Pattern Editor audition during playback", "pass", "Pattern Editor reads the persisted option before every audition path."),
  item("22", "185-186", "option.lock-marked", "Prevent editing marked Variable Positions", "pass", "Marked Position edits, Position transfers, and per-Voice transfers are blocked while Lock Marked Variables is enabled."),
  item("22", "186", "option.echo-background", "Continue processing MIDI input while another application is foreground", "not-applicable", "Web MIDI delivery while backgrounded is controlled by the browser/OS rather than application foreground state."),

  item("A", "187", "power.shift-numerical", "Shift-click a Numerical to copy the most recently changed numerical value", "pass", "The app tracks the most recently edited Numerical and Shift-click copies it with destination min/max/step clamping."),
  item("A", "187", "power.pattern-group-no-sync", "Option-click Pattern Group without Sync", "pass", "Ordinary Pattern Group clicks Sync; Option/Alt-click selects without resetting playback."),
  item("A", "188", "power.shift-hold", "Quantize Hold/Do or Snapshot storage with Shift", "pass", "Shift-clicking Do or a Snapshot at the end of Hold schedules the held change on the Snapshot rhythmic boundary."),
  item("A", "188", "power.shift-snapshot-sync", "Shift-execute a Snapshot to force Sync", "pass", "Shift-click and capital-letter Snapshot execution recall first and then explicitly force Sync on the same quantized boundary."),
  item("A", "188-189", "keyboard.transport", "Support Space, Return, and Tab for Start/Sync, Stop, and Pause", "pass", "Conductor global key handler and store tests cover these keys."),
  item("A", "188", "keyboard.hold-do", "Use Backspace for Hold/Do", "pass", "SnapshotWindow registers Backspace."),
  item("A", "188", "keyboard.clear", "Use Clear/Delete as the Edit Clear command", "pass", "Pattern Editor maps browser Delete/Clear to the same Region-or-Pattern Clear command."),
  item("A", "188", "keyboard.editor-audition", "Use tilde and comma/greater-than to audition counter and legend steps", "pass", "PatternEditor key handler implements both audition paths."),
  item("A", "188", "keyboard.mouse-advance", "Momentarily or latched-enable Mouse Advance from modifiers/Caps Lock", "pass", "Global mouse motion is gated by Command-Option or Caps Lock and advances every enabled Mouse Advance Voice."),
  item("A", "188", "keyboard.snapshots", "Use A-Z for Snapshot store/execute and Shift/capital for forced Sync", "pass", "A-Z recalls stored Snapshots, stores the Hold draft, and capital letters force Sync after quantized execution."),
  item("A", "188-189", "keyboard.slideshows", "Use 1-9, 0, Option-Tab, and backslash shortcuts for Slideshows", "pass", "SnapshotWindow global key handler covers play, record, stop, pause, and loop."),
];

export function conformanceCounts(items: readonly ManualCapability[] = MANUAL_CAPABILITIES) {
  return items.reduce((counts, capability) => {
    counts[capability.result] += 1;
    return counts;
  }, { pass: 0, partial: 0, fail: 0, "not-applicable": 0 } satisfies Record<ConformanceResult, number>);
}

/**
 * Red capabilities split by product sequencing. Existing gaps extend a system
 * that already performs useful work; new capabilities require a new runtime or
 * domain subsystem even when a placeholder control is already visible.
 */
export const EXISTING_FUNCTIONALITY_GAP_IDS = [
] as const;

export const NEW_FUNCTIONALITY_IDS = [
] as const;

const EXISTING_GAPS = new Set<string>(EXISTING_FUNCTIONALITY_GAP_IDS);
const NEW_CAPABILITIES = new Set<string>(NEW_FUNCTIONALITY_IDS);

export type ConformanceTrack = "implemented" | "existing-gap" | "new" | "exception";

export function conformanceTrack(capability: ManualCapability): ConformanceTrack {
  if (capability.result === "pass") return "implemented";
  if (capability.result === "not-applicable") return "exception";
  if (EXISTING_GAPS.has(capability.id)) return "existing-gap";
  if (NEW_CAPABILITIES.has(capability.id)) return "new";
  throw new Error(`Ungrouped red manual capability: ${capability.id}`);
}

export function conformanceTrackCounts(
  items: readonly ManualCapability[] = MANUAL_CAPABILITIES,
): Record<ConformanceTrack, number> {
  return items.reduce((counts, capability) => {
    counts[conformanceTrack(capability)] += 1;
    return counts;
  }, { implemented: 0, "existing-gap": 0, new: 0, exception: 0 });
}
