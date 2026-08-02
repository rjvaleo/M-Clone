import { useEffect, useRef } from "react";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { ConductingArrow } from "./ConductingArrow";
import { runSnapshotGesture } from "./snapshotgesture";
import { positionFromBaton } from "../engine/conductor";
import {
  classicConductorLayoutStyle,
  conductorControlTone,
  type ConductorControl,
} from "./conductorappearance";

const RATIOS = [1, 2, 4, 8, 16] as const;

function TransportGlyph({ kind }: { kind: ConductorControl | "robot" }) {
  if (kind === "start") {
    return <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M8 4 25 16 8 28Z" />
    </svg>;
  }
  if (kind === "stop") {
    return <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M11 4h10l7 7v10l-7 7H11l-7-7V11Z" />
    </svg>;
  }
  if (kind === "pause") {
    return <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M8 5h6v22H8zm11 0h6v22h-6z" />
    </svg>;
  }
  if (kind === "movie") {
    return (
      <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
        <path d="M3 5h26v22H3zM6 8v5h4V8zm8 0v5h4V8zm8 0v5h4V8zM6 19v5h4v-5zm8 0v5h4v-5zm8 0v5h4v-5zM5 15v2h22v-2z" fillRule="evenodd" />
      </svg>
    );
  }
  if (kind === "sequence") {
    return (
      <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" d="M6 2h15l6 6v22H6Z M21 2v7h6" />
        <path d="M13 14h8v2h3v8h-3v3h-8v-3h-3v-8h3zm3 3v7h3v-7z" fillRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M21 3h6v3h-2v3h-3v3h-4V9h2V6h1z" />
      <path fill="none" stroke="currentColor" strokeWidth="2"
        d="M4 27h23M7 24l5-8 5 2 3-8 3 1-2 10 5 3M9 21l7 6M13 17l-4-5" />
    </svg>
  );
}

export function ConductorWindow() {
  const isPlaying = useM((s) => s.isPlaying);
  const isPaused = useM((s) => s.isPaused);
  const tempo = useM((s) => s.project.tempo);
  const baton = useM((s) => s.baton);
  const tempoRange = useM((s) => s.tempoRange);
  const tempoArrow = useM((s) =>
    s.arrows.tempo ?? { on: false, dir: "right" as const });
  const robot = useM((s) => s.robotConductor);
  const robotRange = useM((s) => s.robotRange);
  const robotTimeBase = useM((s) => s.robotTimeBase);
  const syncRatio = useM((s) => s.syncRatio);
  const syncDirection = useM((s) => s.syncRatioDirection);
  const setPlaying = useM((s) => s.setPlaying);
  const setPaused = useM((s) => s.setPaused);
  const setArrow = useM((s) => s.setArrow);
  const conductAt = useM((s) => s.conductAt);
  const clearContinuousConducting = useM((s) => s.clearContinuousConducting);
  const setTempoRange = useM((s) => s.setTempoRange);
  const setTempo = useM((s) => s.setTempo);
  const setRobot = useM((s) => s.setRobot);
  const setRobotRange = useM((s) => s.setRobotRange);
  const setRobotTimeBase = useM((s) => s.setRobotTimeBase);
  const setSyncRatio = useM((s) => s.setSyncRatio);
  const setSyncDirection = useM((s) => s.setSyncRatioDirection);
  const robotStep = useM((s) => s.robotStep);
  const movieMode = useM((s) => s.movieRecorder.mode);
  const toggleMovieRecording = useM((s) => s.toggleMovieRecording);
  const stopMovieRecording = useM((s) => s.stopMovieRecording);
  const grid = useRef<HTMLDivElement>(null);

  const start = async () => {
    if (isPaused) await getRuntime().resume();
    else await getRuntime().start();
    setPaused(false);
    setPlaying(true);
  };
  const stop = () => {
    getRuntime().stop();
    stopMovieRecording();
    setPaused(false);
    setPlaying(false);
  };
  const pause = () => {
    if (!isPlaying && !isPaused) return;
    if (isPaused) void start();
    else {
      getRuntime().pause();
      setPaused(true);
      setPlaying(false);
    }
  };
  const sync = () => runSnapshotGesture({
    quantize: useM.getState().snapshotQuantize,
    tempo: useM.getState().project.tempo,
    elapsedSec: getRuntime().transportElapsedSec(),
    recall: () => getRuntime().sync(),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (isPlaying) sync();
        else void start();
      } else if (event.key === "Enter") {
        event.preventDefault();
        stop();
      } else if (event.key === "Tab") {
        event.preventDefault();
        pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!robot || !isPlaying || isPaused) return;
    const milliseconds = Math.max(40, (60 / tempo) * (4 / robotTimeBase) * 1000);
    const timer = setInterval(() => {
      robotStep(Math.random() * 2 - 1, Math.random() * 2 - 1);
    }, milliseconds);
    return () => clearInterval(timer);
  }, [robot, isPlaying, isPaused, tempo, robotTimeBase, robotStep]);

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = grid.current!.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const state = useM.getState();
    if (event.altKey) {
      clearContinuousConducting();
      return;
    }
    const quantized = {
      quantize: state.snapshotQuantize,
      tempo: state.project.tempo,
      elapsedSec: getRuntime().transportElapsedSec(),
    };
    if (event.shiftKey) {
      runSnapshotGesture({
        ...quantized,
        recall: () => useM.getState().conductAt(x, y, { record: true }),
      });
      return;
    }
    conductAt(x, y, { snapshots: false });
    const arrow = state.arrows.snapshot;
    if (!arrow?.on) return;
    const index = positionFromBaton({ x, y }, arrow.dir);
    if (!state.snapshots[index]) return;
    runSnapshotGesture({
      ...quantized,
      recall: () => useM.getState().recallSnapshot(index),
    });
  };

  return (
    <div className="uconduct" style={classicConductorLayoutStyle()}>
      <div className="uconduct__left">
        <div className="uconduct__transport">
          <button aria-label="Start" title="Start (Space)" onClick={() => void start()}
            className={`uconduct__tone--${conductorControlTone("start")}${isPlaying ? " is-on" : ""}`}><TransportGlyph kind="start" /></button>
          <button aria-label="Stop" title="Stop (Return)" onClick={stop}
            className={`uconduct__tone--${conductorControlTone("stop")}`}>
            <TransportGlyph kind="stop" />
          </button>
          <button aria-label="Pause" title="Pause (Tab)" onClick={pause}
            className={`uconduct__tone--${conductorControlTone("pause")}${isPaused ? " is-on" : ""}`}><TransportGlyph kind="pause" /></button>
        </div>
        <div className="uconduct__secondary">
          <button className={`uconduct__sync uconduct__tone--${conductorControlTone("sync")}`} onClick={sync}>Sync</button>
          <button title={movieMode === "idle"
              ? "Arm Movie recording before Start"
              : "Movie is armed or recording — click to finish"}
            aria-label="Movie recording" onClick={toggleMovieRecording}
            className={`uconduct__tone--${conductorControlTone("movie")}${movieMode === "idle" ? "" : " is-on"}`}>
            <TransportGlyph kind="movie" />
          </button>
          <button disabled className={`uconduct__tone--${conductorControlTone("sequence")}`} title="No imported MIDI Sequence is loaded"
            aria-label="Sequence Play Enable"><TransportGlyph kind="sequence" /></button>
        </div>
      </div>

      <div
        ref={grid}
        className="uconduct__grid"
        role="application"
        aria-label="Conducting Grid"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            pointFromEvent(event);
          }
        }}
      >
        <span className="uconduct__baton"
          style={{ left: `${baton.x * 100}%`, top: `${baton.y * 100}%` }} />
      </div>

      <div className="uconduct__bottom">
        <ConductingArrow label="Tempo" state={tempoArrow}
          onChange={(next) => setArrow("tempo", next)}
          className="uconduct__tempo-arrow" />
        <div className="uconduct__tempo">
          <div className="uconduct__range">
            <input aria-label="Tempo range low" type="range" min={40} max={240}
              value={tempoRange.low}
              onChange={(event) =>
                setTempoRange(Number(event.target.value), tempoRange.high)} />
            <input aria-label="Tempo range high" type="range" min={40} max={240}
              value={tempoRange.high}
              onChange={(event) =>
                setTempoRange(tempoRange.low, Number(event.target.value))} />
            <span className="uconduct__tempo-mark"
              style={{ left: `${((tempo - 40) / 200) * 100}%` }} />
          </div>
          <div className="uconduct__tempo-readout">
            <span>{tempoRange.low}</span><b>Tempo</b>
            <input type="number" min={40} max={240} value={tempo}
              aria-label="Tempo Numerical"
              onChange={(event) => setTempo(Math.max(40, Math.min(240, Number(event.target.value))))} />
            <span>{tempoRange.high}</span>
          </div>
        </div>
        <button className="uconduct__ratio-dir"
          aria-label={`Sync Ratio direction ${syncDirection}`}
          onClick={() => setSyncDirection(syncDirection === "out" ? "in" : "out")}>
          {syncDirection === "out" ? "♩→" : "→♩"}
        </button>
        <select className="uconduct__ratio" aria-label="Sync Ratio"
          value={syncRatio} onChange={(event) => setSyncRatio(Number(event.target.value))}>
          {RATIOS.map((value) => <option key={value} value={value}>1/{value}</option>)}
        </select>
        <button className={"uconduct__robot" + (robot ? " is-on" : "")}
          aria-pressed={robot} aria-label="Robot Conductor"
          title="Automatic Conducting Enable"
          onClick={() => setRobot(!robot)}><TransportGlyph kind="robot" /></button>
        <label className="uconduct__robot-range">H
          <input type="range" min={0} max={1} step={0.05} value={robotRange.x}
            aria-label="Robot horizontal movement range"
            onChange={(event) => setRobotRange("x", Number(event.target.value))} />
        </label>
        <label className="uconduct__robot-range">V
          <input type="range" min={0} max={1} step={0.05} value={robotRange.y}
            aria-label="Robot vertical movement range"
            onChange={(event) => setRobotRange("y", Number(event.target.value))} />
        </label>
        <select className="uconduct__robot-time" aria-label="Robot Time Base"
          value={robotTimeBase}
          onChange={(event) => setRobotTimeBase(Number(event.target.value))}>
          {RATIOS.map((value) => <option key={value} value={value}>1/{value}</option>)}
        </select>
      </div>
    </div>
  );
}
