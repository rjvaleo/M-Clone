import type { PositionVarId } from "./variables";

export type SlideshowAction =
  | { type: "snapshot"; index: number }
  | { type: "position"; variable: PositionVarId; position: number };

export type SlideshowEvent = { atSec: number; action: SlideshowAction };
export type Slideshow = { events: SlideshowEvent[]; loopAtSec: number | null };

export type SlideshowTransport = {
  mode: "idle" | "recording" | "playing";
  slot: number | null;
  waiting: boolean;
  paused: boolean;
  startedAtSec: number;
  pausedAtSec: number | null;
  cursor: number;
};

export const EMPTY_SLIDESHOW: Slideshow = { events: [], loopAtSec: null };
export const IDLE_SLIDESHOW_TRANSPORT: SlideshowTransport = {
  mode: "idle", slot: null, waiting: false, paused: false,
  startedAtSec: 0, pausedAtSec: null, cursor: 0,
};

export function beginSlideshowRecording(
  slot: number, nowSec: number, recordWait: boolean,
): SlideshowTransport {
  return {
    mode: "recording", slot, waiting: recordWait, paused: recordWait,
    startedAtSec: nowSec, pausedAtSec: recordWait ? nowSec : null, cursor: 0,
  };
}

export function addSlideshowAction(
  state: SlideshowTransport,
  slideshow: Slideshow,
  action: SlideshowAction,
  nowSec: number,
): { state: SlideshowTransport; slideshow: Slideshow } {
  if (state.mode !== "recording" || (state.paused && !state.waiting)) {
    return { state, slideshow };
  }
  const first = state.waiting;
  const startedAtSec = first ? nowSec : state.startedAtSec;
  return {
    state: {
      ...state, waiting: false, paused: false, pausedAtSec: null, startedAtSec,
    },
    slideshow: {
      ...slideshow,
      events: [...slideshow.events, {
        atSec: Math.max(0, nowSec - startedAtSec), action,
      }],
    },
  };
}

export function finishSlideshowRecording(
  state: SlideshowTransport,
  slideshow: Slideshow,
  nowSec: number,
  loop: boolean,
): { state: SlideshowTransport; slideshow: Slideshow } {
  if (state.mode !== "recording") return { state, slideshow };
  const elapsed = state.waiting ? 0 : Math.max(0, nowSec - state.startedAtSec);
  return {
    state: IDLE_SLIDESHOW_TRANSPORT,
    slideshow: loop ? addSlideshowLoop(slideshow, elapsed) : slideshow,
  };
}

export function beginSlideshowPlayback(
  slot: number, nowSec: number, delaySec: number, musicRunning: boolean,
): SlideshowTransport {
  return {
    mode: "playing", slot, waiting: false, paused: !musicRunning,
    startedAtSec: nowSec + Math.max(0, delaySec),
    pausedAtSec: musicRunning ? null : nowSec,
    cursor: 0,
  };
}

export function pauseSlideshow(
  state: SlideshowTransport, nowSec: number,
): SlideshowTransport {
  if (state.mode === "idle" || state.paused) return state;
  return { ...state, paused: true, pausedAtSec: nowSec };
}

export function resumeSlideshow(
  state: SlideshowTransport, nowSec: number,
): SlideshowTransport {
  if (state.mode === "idle" || !state.paused) return state;
  const pausedFor = Math.max(0, nowSec - (state.pausedAtSec ?? nowSec));
  return {
    ...state, paused: false, pausedAtSec: null,
    startedAtSec: state.startedAtSec + pausedFor,
  };
}

export function addSlideshowLoop(slideshow: Slideshow, atSec: number): Slideshow {
  const lastEvent = slideshow.events[slideshow.events.length - 1]?.atSec ?? 0;
  return { ...slideshow, loopAtSec: Math.max(lastEvent, atSec) };
}

export function advanceSlideshow(
  state: SlideshowTransport,
  slideshow: Slideshow,
  nowSec: number,
): { state: SlideshowTransport; actions: SlideshowAction[] } {
  if (state.mode !== "playing" || state.paused || nowSec < state.startedAtSec) {
    return { state, actions: [] };
  }
  const elapsed = nowSec - state.startedAtSec;
  const actions: SlideshowAction[] = [];
  let cursor = state.cursor;
  while (cursor < slideshow.events.length && slideshow.events[cursor].atSec <= elapsed) {
    actions.push(slideshow.events[cursor].action);
    cursor += 1;
  }
  if (cursor < slideshow.events.length) return { state: { ...state, cursor }, actions };
  if (slideshow.loopAtSec !== null && slideshow.loopAtSec > 0) {
    if (elapsed < slideshow.loopAtSec) {
      return { state: { ...state, cursor }, actions };
    }
    return {
      state: { ...state, cursor: 0, startedAtSec: state.startedAtSec + slideshow.loopAtSec },
      actions,
    };
  }
  return { state: IDLE_SLIDESHOW_TRANSPORT, actions };
}
