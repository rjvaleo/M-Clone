import { useEffect, useRef } from "react";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { ConductingArrow } from "./ConductingArrow";

const RATIOS = [1, 2, 4, 8, 16] as const;

function TransportGlyph({ kind }: {
  kind: "start" | "stop" | "pause" | "movie" | "sequence" | "robot";
}) {
  if (kind === "start") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4 25 16 8 28Z" /></svg>;
  }
  if (kind === "stop") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 4h12l6 6v12l-6 6H10l-6-6V10Z" /></svg>;
  }
  if (kind === "pause") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5h5v22H8zm11 0h5v22h-5z" /></svg>;
  }
  if (kind === "movie") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="6" width="26" height="20" />
        {[6, 13, 20].map((x) => <rect key={`top-${x}`} x={x} y="8" width="4" height="5" fill="var(--panel)" />)}
        {[6, 13, 20].map((x) => <rect key={`bottom-${x}`} x={x} y="19" width="4" height="5" fill="var(--panel)" />)}
        <rect x="4" y="15" width="24" height="2" fill="var(--panel)" />
      </svg>
    );
  }
  if (kind === "sequence") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" d="M7 3h14l5 5v21H7Z" />
        <path fill="none" stroke="currentColor" strokeWidth="2" d="M21 3v6h5" />
        <circle cx="17" cy="20" r="6" />
        <circle cx="17" cy="20" r="2.5" fill="var(--panel)" />
        <path d="M16 11h2v4h-2zm0 14h2v4h-2zM8 19h4v2H8zm14 0h4v2h-4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2"
        d="M5 27c3-7 7-9 12-8l3-7 3 1-1 7c4 2 5 5 5 7M7 25l9 3m-6-8 5 3" />
      <path d="M18 7c2-4 7-3 8 0-2 3-5 5-8 5-2-1-2-4 0-5Z" />
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
  const sync = () => getRuntime().sync();

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
    conductAt(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  return (
    <div className="uconduct">
      <div className="uconduct__left">
        <div className="uconduct__transport">
          <button aria-label="Start" title="Start (Space)" onClick={() => void start()}
            className={isPlaying ? "is-on" : ""}><TransportGlyph kind="start" /></button>
          <button aria-label="Stop" title="Stop (Return)" onClick={stop}>
            <TransportGlyph kind="stop" />
          </button>
          <button aria-label="Pause" title="Pause (Tab)" onClick={pause}
            className={isPaused ? "is-on" : ""}><TransportGlyph kind="pause" /></button>
        </div>
        <div className="uconduct__secondary">
          <button className="uconduct__sync" onClick={sync}>Sync</button>
          <button title={movieMode === "idle"
              ? "Arm Movie recording before Start"
              : "Movie is armed or recording — click to finish"}
            aria-label="Movie recording" onClick={toggleMovieRecording}
            className={movieMode === "idle" ? "" : "is-on"}>
            <TransportGlyph kind="movie" />
          </button>
          <button disabled title="No imported MIDI Sequence is loaded"
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
