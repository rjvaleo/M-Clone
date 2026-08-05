import { describe, expect, it } from "vitest";
import { NoteSchedule, MAX_SCHEDULED_NOTES, type ScheduledNote } from "./noteSchedule";

const on = (frame: number, note: number): ScheduledNote => ({
  frame,
  nodeId: "n1",
  event: { type: "note-on", note, velocity: 1, detuneCents: 0 },
});

const notes = (drained: ScheduledNote[]): number[] =>
  drained.map((entry) => (entry.event.type === "note-on" ? entry.event.note : -1));

describe("NoteSchedule", () => {
  it("has nothing to do when it is empty", () => {
    const schedule = new NoteSchedule();
    expect(schedule.nextFrame()).toBeUndefined();
    expect(schedule.drainThrough(1_000_000)).toEqual([]);
    expect(schedule.size).toBe(0);
  });

  it("reports the earliest frame it is holding, whatever order things arrived", () => {
    // The render loop asks this to decide where to break the quantum, so it
    // has to be the earliest rather than the most recently pushed.
    const schedule = new NoteSchedule();
    schedule.push(on(900, 67));
    schedule.push(on(100, 60));
    schedule.push(on(500, 64));
    expect(schedule.nextFrame()).toBe(100);
  });

  it("releases notes in time order, not arrival order", () => {
    const schedule = new NoteSchedule();
    schedule.push(on(900, 67));
    schedule.push(on(100, 60));
    schedule.push(on(500, 64));
    expect(notes(schedule.drainThrough(1000))).toEqual([60, 64, 67]);
  });

  it("keeps notes that are not due yet", () => {
    const schedule = new NoteSchedule();
    schedule.push(on(100, 60));
    schedule.push(on(500, 64));
    expect(notes(schedule.drainThrough(200))).toEqual([60]);
    expect(schedule.nextFrame()).toBe(500);
  });

  it("releases a note landing exactly on the frame asked for", () => {
    // Inclusive, because the render loop passes the frame it is about to
    // render: a note at that frame belongs to the samples that follow it, and
    // holding it back would put it a whole quantum late.
    const schedule = new NoteSchedule();
    schedule.push(on(128, 60));
    expect(notes(schedule.drainThrough(128))).toEqual([60]);
  });

  it("releases a note whose moment has already passed", () => {
    // Late, but a note the host was slow to deliver still has to sound. The
    // alternative is a note that silently never plays.
    const schedule = new NoteSchedule();
    schedule.push(on(50, 60));
    expect(notes(schedule.drainThrough(9000))).toEqual([60]);
  });

  it("keeps two notes at the same frame, in the order they were asked for", () => {
    // A chord is several messages at one time, and a schedule that treated the
    // frame as a key would play one note of it.
    const schedule = new NoteSchedule();
    schedule.push(on(100, 60));
    schedule.push(on(100, 64));
    schedule.push(on(100, 67));
    expect(notes(schedule.drainThrough(100))).toEqual([60, 64, 67]);
  });

  it("keeps a note-off after the note-on it belongs to at the same frame", () => {
    // Stability matters most here: reordering these turns a note into a
    // permanently stuck one.
    const schedule = new NoteSchedule();
    schedule.push({ frame: 100, nodeId: "n1", event: { type: "note-on", note: 60, velocity: 1, detuneCents: 0 } });
    schedule.push({ frame: 100, nodeId: "n1", event: { type: "note-off", note: 60 } });
    const drained = schedule.drainThrough(100);
    expect(drained.map((entry) => entry.event.type)).toEqual(["note-on", "note-off"]);
  });

  it("drops the furthest-future note when it is full", () => {
    // A bounded queue on the audio thread has to shed something. It sheds the
    // note that is furthest away, because the imminent ones are the ones a
    // listener is about to notice missing — and because the far-future note
    // may well be re-sent before its moment arrives.
    const schedule = new NoteSchedule();
    for (let i = 0; i < MAX_SCHEDULED_NOTES; i += 1) schedule.push(on(i * 10, 60));
    expect(schedule.size).toBe(MAX_SCHEDULED_NOTES);

    schedule.push(on(5, 99));
    expect(schedule.size).toBe(MAX_SCHEDULED_NOTES);
    expect(schedule.nextFrame()).toBe(0);
    // The new near note survived; the far one it displaced did not.
    const drained = notes(schedule.drainThrough(Number.MAX_SAFE_INTEGER));
    expect(drained).toContain(99);
    expect(drained).toHaveLength(MAX_SCHEDULED_NOTES);
  });

  it("refuses a note further away than everything it already holds", () => {
    // The mirror of the rule above: if the newcomer is the furthest away, it
    // is the one that goes, rather than displacing something sooner.
    const schedule = new NoteSchedule();
    for (let i = 0; i < MAX_SCHEDULED_NOTES; i += 1) schedule.push(on(i * 10, 60));
    schedule.push(on(999_999, 99));
    expect(notes(schedule.drainThrough(Number.MAX_SAFE_INTEGER))).not.toContain(99);
  });

  it("forgets everything when the transport stops", () => {
    const schedule = new NoteSchedule();
    schedule.push(on(100, 60));
    schedule.clear();
    expect(schedule.size).toBe(0);
    expect(schedule.nextFrame()).toBeUndefined();
  });

  it("ignores a note scheduled for a frame that is not a number", () => {
    // A NaN frame would sort unpredictably and could never be drained, so it
    // would sit in a bounded queue forever displacing real notes.
    const schedule = new NoteSchedule();
    schedule.push(on(Number.NaN, 60));
    expect(schedule.size).toBe(0);
  });
});
