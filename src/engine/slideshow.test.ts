import { describe, expect, it } from "vitest";
import {
  addSlideshowAction,
  addSlideshowLoop,
  advanceSlideshow,
  beginSlideshowPlayback,
  beginSlideshowRecording,
  finishSlideshowRecording,
  pauseSlideshow,
  resumeSlideshow,
  type Slideshow,
} from "./slideshow";

describe("Slideshow recording", () => {
  it("ignores actions and finish requests outside recording", () => {
    const show: Slideshow = { events: [], loopAtSec: null };
    const idle = beginSlideshowPlayback(0, 0, 0, true);
    expect(addSlideshowAction(idle, show, { type: "snapshot", index: 0 }, 1))
      .toEqual({ state: idle, slideshow: show });
    expect(finishSlideshowRecording(idle, show, 1, false))
      .toEqual({ state: idle, slideshow: show });
  });
  it("Record Wait makes the first executed action time zero", () => {
    let state = beginSlideshowRecording(2, 10, true);
    let show: Slideshow = { events: [], loopAtSec: null };
    ({ state, slideshow: show } = addSlideshowAction(
      state, show, { type: "snapshot", index: 0 }, 14,
    ));
    ({ state, slideshow: show } = addSlideshowAction(
      state, show, { type: "snapshot", index: 1 }, 15.5,
    ));
    expect(show.events).toEqual([
      { atSec: 0, action: { type: "snapshot", index: 0 } },
      { atSec: 1.5, action: { type: "snapshot", index: 1 } },
    ]);
    expect(state.waiting).toBe(false);
  });

  it("records time immediately when Record Wait is disabled", () => {
    const state = beginSlideshowRecording(0, 10, false);
    const result = addSlideshowAction(
      state, { events: [], loopAtSec: null },
      { type: "position", variable: "density", position: 3 }, 12,
    );
    expect(result.slideshow.events[0].atSec).toBe(2);
  });

  it("the Loop command finishes recording and places a loop at the end", () => {
    let state = beginSlideshowRecording(0, 0, false);
    let show: Slideshow = { events: [], loopAtSec: null };
    ({ state, slideshow: show } = addSlideshowAction(
      state, show, { type: "snapshot", index: 0 }, 1,
    ));
    const done = finishSlideshowRecording(state, show, 2.5, true);
    expect(done.state.mode).toBe("idle");
    expect(done.slideshow.loopAtSec).toBe(2.5);
  });

  it("can stop a waiting recording without adding a loop", () => {
    const state = beginSlideshowRecording(0, 3, true);
    const show: Slideshow = { events: [], loopAtSec: null };
    expect(finishSlideshowRecording(state, show, 9, false)).toEqual({
      state: expect.objectContaining({ mode: "idle" }), slideshow: show,
    });
  });

  it("does not record actions while an active recording is paused", () => {
    let state = beginSlideshowRecording(0, 0, false);
    state = pauseSlideshow(state, 1);
    const show: Slideshow = { events: [], loopAtSec: null };
    expect(addSlideshowAction(state, show, { type: "snapshot", index: 0 }, 2).slideshow.events)
      .toEqual([]);
  });
});

describe("Slideshow playback", () => {
  const show: Slideshow = {
    events: [
      { atSec: 0, action: { type: "snapshot", index: 0 } },
      { atSec: 1, action: { type: "snapshot", index: 1 } },
    ],
    loopAtSec: null,
  };

  it("starts after Snapshot quantization and emits each due action once", () => {
    let state = beginSlideshowPlayback(0, 10, 0.5, true);
    let step = advanceSlideshow(state, show, 10.4);
    expect(step.actions).toEqual([]);
    step = advanceSlideshow(step.state, show, 10.5);
    expect(step.actions).toEqual([{ type: "snapshot", index: 0 }]);
    step = advanceSlideshow(step.state, show, 11.5);
    expect(step.actions).toEqual([{ type: "snapshot", index: 1 }]);
    expect(step.state.mode).toBe("idle");
  });

  it("waits while music is stopped, then starts when music starts", () => {
    let state = beginSlideshowPlayback(0, 10, 0, false);
    expect(state.paused).toBe(true);
    state = resumeSlideshow(state, 20);
    expect(advanceSlideshow(state, show, 20).actions)
      .toEqual([{ type: "snapshot", index: 0 }]);
  });

  it("pause preserves the remaining time", () => {
    let state = beginSlideshowPlayback(0, 0, 0, true);
    state = advanceSlideshow(state, show, 0).state;
    state = pauseSlideshow(state, 0.4);
    state = resumeSlideshow(state, 10);
    expect(advanceSlideshow(state, show, 10.5).actions).toEqual([]);
    expect(advanceSlideshow(state, show, 10.6).actions)
      .toEqual([{ type: "snapshot", index: 1 }]);
  });

  it("loops at the recorded loop point", () => {
    const looped = addSlideshowLoop(show, 1.5);
    let state = beginSlideshowPlayback(0, 0, 0, true);
    let step = advanceSlideshow(state, looped, 0);
    state = step.state;
    step = advanceSlideshow(state, looped, 1);
    state = step.state;
    step = advanceSlideshow(state, looped, 1.5);
    expect(step.state.mode).toBe("playing");
    expect(step.state.cursor).toBe(0);
    expect(advanceSlideshow(step.state, looped, 1.5).actions)
      .toEqual([{ type: "snapshot", index: 0 }]);
  });

  it("leaves idle/already-paused transport alone and supports empty loops", () => {
    const idle = { ...beginSlideshowPlayback(0, 0, -1, true), mode: "idle" as const };
    expect(pauseSlideshow(idle, 1)).toBe(idle);
    expect(resumeSlideshow(idle, 1)).toBe(idle);
    const paused = pauseSlideshow(beginSlideshowPlayback(0, 0, 0, true), 1);
    expect(pauseSlideshow(paused, 2)).toBe(paused);
    expect(resumeSlideshow({ ...paused, pausedAtSec: null }, 2).paused).toBe(false);
    expect(addSlideshowLoop({ events: [], loopAtSec: null }, -2).loopAtSec).toBe(0);
  });
});
