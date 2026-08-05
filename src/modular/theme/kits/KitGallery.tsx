// The kit system's proving ground — every kit, every control, live and
// draggable, before any of it touches a real node face. Same role
// `public/engine-test.html` played for the Rust audio engine: a place to
// see and verify the thing works, separate from the risk of wiring it into
// the running app. Not part of the production build; reached only via
// `kit-gallery.html`.

import { useState } from "react";
import { KitContext } from "./KitContext";
import { KIT_IDS, type KitId, KIT_META } from "./types";
import type { EnvelopeShape } from "./geometry";
import { Knob } from "./controls/Knob";
import { Slider } from "./controls/Slider";
import { Fader } from "./controls/Fader";
import { Toggle } from "./controls/Toggle";
import { Button } from "./controls/Button";
import { Pad } from "./controls/Pad";
import { Selector } from "./controls/Selector";
import { Stepper } from "./controls/Stepper";
import { Jack } from "./controls/Jack";
import { Led } from "./controls/Led";
import { Meter } from "./controls/Meter";
import { Display } from "./controls/Display";
import { Envelope } from "./controls/Envelope";
import { Waveform } from "./controls/Waveform";
import { AdsrGroup, FilterGroup, Group } from "./layout";

/**
 * A deterministic decaying burst — enough shape to show a waveform's markers,
 * region and playhead without loading an actual sample.
 *
 * The per-column jitter comes from stepping a sine by the golden angle, which
 * never repeats over this length: a smooth low-frequency curve would draw a
 * row of lens shapes rather than anything anyone would recognise as audio.
 */
const PEAKS = Array.from({ length: 128 }, (_, i) => {
  const decay = Math.exp((-i / 127) * 2.1);
  const grain = 0.35 + 0.65 * Math.abs(Math.sin(i * 2.399963));
  return Math.min(1, decay * grain * 1.25);
});

const FILTER_TYPES = [
  { value: "lp", label: "LP" },
  { value: "bp", label: "BP" },
  { value: "hp", label: "HP" },
];

const SYNC_RATES = [
  { value: "1/4", label: "1/4" },
  { value: "1/8", label: "1/8" },
  { value: "1/16", label: "1/16" },
];

const VOICE_MODES = [
  { value: "poly", label: "Poly" },
  { value: "mono", label: "Mono retrig" },
  { value: "legato", label: "Mono legato" },
];

// Sound-class tints, the way the ADSR Drum Machine colours its pad labels.
const PADS = [
  { label: "Kick", sublabel: "C1", tint: "#e8486b" },
  { label: "Snare", sublabel: "E1", tint: "#4aa8e8" },
  { label: "Hihat", sublabel: "G♯1", tint: "#5fd08a" },
  { label: "Clap", sublabel: "C2", tint: "#e8a34a" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="kg-section">
      <h3 className="kg-section__title">{title}</h3>
      <div className="kg-section__body">{children}</div>
    </div>
  );
}

function KitCard({ id }: { id: KitId }) {
  const meta = KIT_META[id];
  const [knobValue, setKnobValue] = useState(65);
  const [sliderValue, setSliderValue] = useState(50);
  const [hSliderValue, setHSliderValue] = useState(30);
  const [faderValue, setFaderValue] = useState(72);
  const [panValue, setPanValue] = useState(50);
  const [toggleValue, setToggleValue] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [ledOn, setLedOn] = useState(true);
  const [stepValue, setStepValue] = useState(3);
  const [filterType, setFilterType] = useState("lp");
  const [syncRate, setSyncRate] = useState("1/8");
  const [voiceMode, setVoiceMode] = useState("poly");
  const [activePad, setActivePad] = useState(0);
  const [env, setEnv] = useState<EnvelopeShape>({ attack: 0.2, decay: 0.5, sustain: 0.6, release: 0.35 });
  const [cutoff, setCutoff] = useState(62);
  const [resonance, setResonance] = useState(28);
  const [drive, setDrive] = useState(15);

  return (
    <KitContext.Provider value={id}>
      <article className="kg-card" data-kit={id}>
        <header className="kg-card__head">
          <div>
            <h2>{meta.label}</h2>
            <p>{meta.blurb}</p>
          </div>
          <span className="kg-card__family">{meta.family}</span>
        </header>

        <Section title="Continuous">
          <Knob value={knobValue} min={0} max={100} label="Cutoff" onChange={setKnobValue} />
          <Knob value={22} min={0} max={100} size={28} label="Res" onChange={() => {}} disabled />
          <Slider value={sliderValue} min={0} max={100} label="Level" onChange={setSliderValue} />
          <Slider
            value={hSliderValue}
            min={0}
            max={100}
            orientation="horizontal"
            length={70}
            label="Pan"
            onChange={setHSliderValue}
          />
          <Fader value={faderValue} min={0} max={100} label="Ch 1" tint="#e8486b" onChange={setFaderValue} />
          <Fader value={panValue} min={0} max={100} label="Pan" detent={50} onChange={setPanValue} />
        </Section>

        <Section title="Discrete">
          <Toggle value={toggleValue} label="Sync" onChange={setToggleValue} />
          <Button label={pressed ? "Playing" : "Play"} pressed={pressed} onClick={() => setPressed((v) => !v)} />
          <Stepper value={stepValue} min={0} max={8} onChange={setStepValue} />
          <Selector options={FILTER_TYPES} value={filterType} variant="segmented" label="Filter type" onChange={setFilterType} />
          <Selector options={SYNC_RATES} value={syncRate} variant="cycle" label="Rate" onChange={setSyncRate} />
          <Selector options={VOICE_MODES} value={voiceMode} variant="list" label="Voice mode" onChange={setVoiceMode} />
        </Section>

        <Section title="Pads">
          {PADS.map((pad, i) => (
            <Pad
              key={pad.label}
              label={pad.label}
              sublabel={pad.sublabel}
              tint={pad.tint}
              active={activePad === i}
              onTrigger={() => setActivePad(i)}
            />
          ))}
        </Section>

        <Section title="Signals">
          <Jack label="OUT" direction="out" connected />
          <Jack label="IN" direction="in" connected={false} />
          <span className="kg-inline">
            <Led on={ledOn} tone="accent" />
            <button type="button" className="kg-led-toggle" onClick={() => setLedOn((v) => !v)}>
              LED
            </button>
          </span>
          <Meter levels={[0.72, 0.55]} peaks={[0.88, 0.62]} label="Master" />
          <Meter levels={[0.4]} orientation="horizontal" length={90} label="Input" />
        </Section>

        <Section title="Readouts">
          <Display label="Gain" value={-0.4} unit="dB" decimals={1} />
          <Display label="Root" value="C3" variant="inline" tone="accent" />
          <Display label="Tune" value={12} variant="chip" />
          <Display label="Length" value={16} />
          <Display label="Choke" value="None" variant="inline" />
        </Section>

        <Section title="Shapes">
          <Envelope value={env} label="Amp" />
          <Waveform
            peaks={PEAKS}
            label="Kick 1"
            region={{ start: 0.12, end: 0.58 }}
            markers={[0.12, 0.58, 0.8]}
            playhead={0.34}
          />
        </Section>

        <Section title="Grouped">
          <Group title="Amp envelope" variant="bar">
            <AdsrGroup value={env} onChange={setEnv} variant="knobs" />
          </Group>
          <Group title="Mod envelope" variant="plate">
            <AdsrGroup value={env} onChange={setEnv} variant="sliders" showShape={false} />
          </Group>
          <FilterGroup
            cutoff={cutoff}
            resonance={resonance}
            drive={drive}
            onCutoff={setCutoff}
            onResonance={setResonance}
            onDrive={setDrive}
            types={FILTER_TYPES}
            type={filterType}
            onType={setFilterType}
          />
        </Section>
      </article>
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
          Six complete control sets — fourteen controls each, one shared
          interaction layer. Drag the knobs, sliders and faders; the Pan fader
          notches at centre. Click everything else; the Rate selector cycles,
          and right-clicking it cycles backwards. Colour comes from the active
          theme's <code>--mm-accent</code>, so switching themes in the real app
          would repaint every kit below without changing a single shape.
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
