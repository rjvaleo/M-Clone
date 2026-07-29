import { useState } from "react";
import { Transport } from "./Transport";
import { OutputBar } from "./OutputBar";
import { VoicePanel } from "./VoicePanel";
import { PatternGrid } from "./PatternGrid";
import { Unified } from "./Unified";

type View = "unified" | "studio";

export function App() {
  const [view, setView] = useState<View>("unified");

  return (
    <div className="app">
      <header className="app__header">
        <h1>
          M<span className="app__sub">-Clone</span>
        </h1>
        <p className="app__tag">An Intelligent Musical Instrument — reborn</p>
        <div className="app__views">
          <button
            className={"vtab" + (view === "unified" ? " vtab--on" : "")}
            onClick={() => setView("unified")}
          >
            Unified
          </button>
          <button
            className={"vtab" + (view === "studio" ? " vtab--on" : "")}
            onClick={() => setView("studio")}
          >
            Studio (v1)
          </button>
        </div>
      </header>

      {view === "unified" ? (
        <Unified />
      ) : (
        <>
          <div className="app__top">
            <Transport />
            <OutputBar />
          </div>
          <VoicePanel />
          <PatternGrid />
        </>
      )}

      <footer className="app__footer">
        {view === "unified"
          ? "Unified classic view — patterns, variable positions (a–f), snapshots, per-voice Midi, dual output. Cyclic grids & Time Distortion are visual previews for now."
          : "Studio v1 — the original vertical slice. Both views drive the same engine."}
      </footer>
    </div>
  );
}
