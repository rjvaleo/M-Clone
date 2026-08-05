// The kit system's proving ground — every kit, every control, live and
// draggable, before any of it touches a real node face. Same role
// `public/engine-test.html` played for the Rust audio engine: a place to
// see and verify the thing works, separate from the risk of wiring it into
// the running app. Not part of the production build; reached only via
// `kit-gallery.html`.

import { useState } from "react";
import { KitContext } from "./KitContext";
import { KIT_IDS, type KitId, KIT_META } from "./types";
import { Knob } from "./controls/Knob";
import { Slider } from "./controls/Slider";
import { Toggle } from "./controls/Toggle";
import { Button } from "./controls/Button";
import { Jack } from "./controls/Jack";
import { Led } from "./controls/Led";
import { Stepper } from "./controls/Stepper";

function KitCard({ id }: { id: KitId }) {
  const meta = KIT_META[id];
  const [knobValue, setKnobValue] = useState(65);
  const [sliderValue, setSliderValue] = useState(50);
  const [hSliderValue, setHSliderValue] = useState(30);
  const [toggleValue, setToggleValue] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [ledOn, setLedOn] = useState(true);
  const [stepValue, setStepValue] = useState(3);

  return (
    <KitContext.Provider value={id}>
      <section className="kg-card" data-kit={id}>
        <header className="kg-card__head">
          <h2>{meta.label}</h2>
          <p>{meta.blurb}</p>
          <span className="kg-card__family">{meta.family}</span>
        </header>

        <div className="kg-card__row">
          <div className="kg-control">
            <Knob value={knobValue} min={0} max={100} label="Cutoff" onChange={setKnobValue} />
          </div>
          <div className="kg-control">
            <Knob value={22} min={0} max={100} size={28} label="Res" onChange={() => {}} disabled />
          </div>
          <div className="kg-control">
            <Slider value={sliderValue} min={0} max={100} label="Level" onChange={setSliderValue} />
          </div>
          <div className="kg-control">
            <Slider
              value={hSliderValue}
              min={0}
              max={100}
              orientation="horizontal"
              length={70}
              label="Pan"
              onChange={setHSliderValue}
            />
          </div>
        </div>

        <div className="kg-card__row kg-card__row--inline">
          <div className="kg-control">
            <Toggle value={toggleValue} label="Sync" onChange={setToggleValue} />
          </div>
          <div className="kg-control">
            <Button label={pressed ? "Playing" : "Play"} pressed={pressed} onClick={() => setPressed((v) => !v)} />
          </div>
          <div className="kg-control">
            <Jack label="OUT" direction="out" connected />
          </div>
          <div className="kg-control">
            <Jack label="IN" direction="in" connected={false} />
          </div>
          <div className="kg-control kg-control--led">
            <Led on={ledOn} tone="accent" />
            <button type="button" className="kg-led-toggle" onClick={() => setLedOn((v) => !v)}>
              LED
            </button>
          </div>
          <div className="kg-control">
            <Stepper value={stepValue} min={0} max={8} onChange={setStepValue} />
          </div>
        </div>
      </section>
    </KitContext.Provider>
  );
}

export function KitGallery() {
  return (
    <div className="kg-page">
      <header className="kg-page__head">
        <p className="kg-eyebrow">idMLab &middot; theme/kits</p>
        <h1>Kit Gallery</h1>
        <p className="kg-lede">
          Six complete control sets, one shared interaction layer. Drag a knob or
          a vertical slider, drag a horizontal slider sideways, click everything
          else. Colour comes from the active theme's <code>--mm-accent</code> —
          this page just applies the app's own stylesheet, so switching themes in
          the real app would repaint every card below without touching a kit's
          shape.
        </p>
      </header>
      <div className="kg-grid">
        {KIT_IDS.map((id) => (
          <KitCard key={id} id={id} />
        ))}
      </div>
    </div>
  );
}
