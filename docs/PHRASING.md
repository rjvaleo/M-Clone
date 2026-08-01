# Phrasing / Legato — Manual-Derived Specification

**Source:** M 2.7 manual, pages 81–84 ("Working with Phrasing" and
"Cyclic Editor Interactions").

## Model correction

M does not define a separate Phrasing Variable. Phrasing is created by the
**Legato Cyclic Variable**. The earlier roadmap item calling for another
four-Voice × six-Position Phrasing module was an incorrect inference from the
manual's section heading. Implementing one would duplicate Legato and diverge
from M.

## Required behavior

- Legato has six Variable Positions. Each Position stores one cycle per Voice,
  with 1–16 steps and five selectable levels (0–4).
- One global set of Legato Value Numericals applies to every Voice, cycle, and
  Position. The manual's demonstrated defaults are 6, 25, 50, 75, and 100%.
- A Legato value is the note's sustain duration as a percentage of the actual
  time from that note onset to the next onset. Values may exceed 100%; 400%
  deliberately overlaps the following three equal-spaced notes.
- A vertical level range makes M choose a level within that inclusive range for
  that event. Seeded playback keeps this deterministic in M-Clone.
- Rhythm decides when Legato and Accent advance. Every generated event or rest
  advances all three cycles by one shared cyclic step.
- Legato, Rhythm, and Accent Positions have Conducting Arrows, participate in
  Hold/Do and partial Snapshots, and Snapshots store only their active Position,
  never their cycle contents.
- Cyclic Position banks, lengths, global values, and active Positions persist in
  the project document. Playback cursors remain transient.

## Delivered implementation

The Cyclic Editor supplies the six Positions, four Voice grids, independent
lengths, editable global values, and draggable random ranges. This milestone:

- corrected the defaults to 6, 25, 50, 75, and 100%;
- calculates sustain from the actual Rhythm/Time-Distortion-adjusted interval to
  the next onset, including values above 100%;
- added Conducting Arrows to Accent, Legato, and Rhythm Positions;
- added Cyclic Position selection to Hold/Do, partial Snapshots, Restore, Blink
  Everything, Slideshows, and document round trips;
- fixed Cyclic Editor opening so a double-click retains the selected variable
  and Position.

The per-Voice Midi Legato control remains a continuous multiplier over the
Cyclic Legato percentage and now defaults to 1.0 (neutral).
