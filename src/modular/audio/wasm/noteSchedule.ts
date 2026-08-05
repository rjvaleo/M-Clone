/**
 * Notes waiting for their moment, on the audio thread.
 *
 * Without this, a note sounds when its `postMessage` happens to be handled.
 * That is the main thread's schedule, not the score's: a quantum is 2.7 ms at
 * 48 kHz and the message can miss several of them under load, so a sequence
 * that is exactly right in the document arrives smeared. The Web Audio path
 * never had this problem, because every node there is scheduled against the
 * audio clock rather than played by hand.
 *
 * So the note carries its frame, the worklet holds it until that frame comes
 * round, and `process_range` renders the quantum in pieces around it. What the
 * host does is convert a time into a frame; what this does is hand the events
 * back in the right order at the right moment.
 *
 * Deliberately a plain sorted array rather than a heap. It holds a few hundred
 * entries at most, insertion is the common operation and draining is a prefix,
 * and `splice` on a small array beats a heap's bookkeeping at this size while
 * being something a reader can check by eye. It also makes stability free,
 * which a heap would not — see the note-off test.
 */

import type { ScheduledEvent } from "./rackProtocol";

export type { ScheduledEvent };

export interface ScheduledNote {
  /** Absolute frame on the audio clock, the same one `currentFrame` counts. */
  frame: number;
  event: ScheduledEvent;
}

/**
 * How many notes may wait at once.
 *
 * Bounded because this lives on the audio thread and a runaway generator
 * upstream must not grow it without limit. Several hundred covers a dense
 * passage many quanta deep; a sequencer that is genuinely this far ahead is
 * scheduling further out than it needs to.
 */
export const MAX_SCHEDULED_NOTES = 512;

export class NoteSchedule {
  private readonly pending: ScheduledNote[] = [];

  constructor(private readonly ceiling: number = MAX_SCHEDULED_NOTES) {}

  get size(): number {
    return this.pending.length;
  }

  /** The earliest frame held, or `undefined` when nothing is waiting. */
  nextFrame(): number | undefined {
    return this.pending[0]?.frame;
  }

  push(entry: ScheduledNote): void {
    // A non-finite frame sorts unpredictably and could never come due, so it
    // would sit in a bounded queue forever, displacing notes that can.
    if (!Number.isFinite(entry.frame)) return;

    // `findIndex` for the first strictly-later entry, so anything already at
    // this frame stays ahead of the newcomer. That keeps a chord in the order
    // it was played and, more importantly, keeps a note-off behind its
    // note-on — swapping those leaves a note stuck on forever.
    const at = this.pending.findIndex((held) => held.frame > entry.frame);
    if (at < 0) {
      // Furthest away of everything held. If the queue is full this is the
      // entry that would be dropped anyway, so it is simply refused.
      if (this.pending.length >= this.ceiling) return;
      this.pending.push(entry);
      return;
    }
    this.pending.splice(at, 0, entry);
    if (this.pending.length > this.ceiling) this.pending.pop();
  }

  /**
   * Everything due at or before `frame`, in time order, removed.
   *
   * Inclusive of `frame` itself: the caller passes the frame it is about to
   * render, and a note at that frame belongs to the samples that follow it.
   * Anything already overdue comes out too — late is the lesser failure, and
   * silently dropping it would look like a note that never existed.
   */
  drainThrough(frame: number): ScheduledNote[] {
    let count = 0;
    while (count < this.pending.length && this.pending[count].frame <= frame) count += 1;
    return count === 0 ? [] : this.pending.splice(0, count);
  }

  /** Forget everything. For a transport stop, where the future is cancelled. */
  clear(): void {
    this.pending.length = 0;
  }
}
