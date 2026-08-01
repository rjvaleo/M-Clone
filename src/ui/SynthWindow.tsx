import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  SYNTH_FILTER_TYPES,
  SYNTH_LFO_DESTINATIONS,
  SYNTH_WAVEFORMS,
  type SynthSettings,
} from "../engine/synth";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { synthChoiceText, synthChoiceWidthCh } from "./synthchoice";
import { knobValueFromDrag } from "./synthknob";

type NumberKey = {
  [K in keyof SynthSettings]: SynthSettings[K] extends number ? K : never
}[keyof SynthSettings];

const SynthVoiceContext = createContext(0);

function displayValue(value: number, unit: string): string {
  if (unit === "Hz" && value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (unit === "s") return value < 1 ? `${Math.round(value * 1000)}m` : value.toFixed(1);
  if (Math.abs(value) < 1 && value !== 0) return value.toFixed(2);
  return `${Math.round(value)}${unit}`;
}

function Knob({ label, ariaLabel = label, setting, min, max, step, unit = "", large = false }: {
  label: string;
  ariaLabel?: string;
  setting: NumberKey;
  min: number;
  max: number;
  step: number;
  unit?: string;
  large?: boolean;
}) {
  const voice = useContext(SynthVoiceContext);
  const value = useM((state) => state.synthSettings[voice][setting] as number);
  const setSynthParam = useM((state) => state.setSynthParam);
  const drag = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);
  const moveKnob = (event: PointerEvent<HTMLInputElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    setSynthParam(voice, setting, knobValueFromDrag(
      drag.current.startValue,
      drag.current.startY - event.clientY,
      min,
      max,
      step,
    ));
  };
  const turn = -135 + ((value - min) / (max - min)) * 270;
  const style = { "--knob-turn": `${turn}deg` } as CSSProperties;
  return (
    <label className={`synthknob${large ? " synthknob--large" : ""}`}
      title={`${ariaLabel}: ${displayValue(value, unit)}`}>
      <span className="synthknob__dial" style={style} aria-hidden="true" />
      <input type="range" min={min} max={max} step={step} value={value}
        aria-label={`${ariaLabel} knob`}
        onPointerDown={(event) => {
          event.preventDefault();
          drag.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={moveKnob}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onChange={(event) => setSynthParam(voice, setting, Number(event.target.value))} />
      <b>{label}</b>
      <output>{displayValue(value, unit)}</output>
    </label>
  );
}

function Choice<K extends keyof SynthSettings>({ label, ariaLabel = label, setting, options }: {
  label: string;
  ariaLabel?: string;
  setting: K;
  options: readonly SynthSettings[K][];
}) {
  const voice = useContext(SynthVoiceContext);
  const value = useM((state) => state.synthSettings[voice][setting]);
  const setSynthParam = useM((state) => state.setSynthParam);
  const style = { "--choice-width": `${synthChoiceWidthCh(options)}ch` } as CSSProperties;
  return (
    <label className="synthchoice">
      <span>{label}</span>
      <select aria-label={ariaLabel} value={String(value)} style={style}
        onChange={(event) => setSynthParam(voice, setting, event.target.value as SynthSettings[K])}>
        {options.map((option) => <option key={String(option)} value={String(option)}>{synthChoiceText(option)}</option>)}
      </select>
    </label>
  );
}

function Octave({ setting, label }: { setting: "oscillatorOctave" | "oscillator2Octave"; label: string }) {
  const voice = useContext(SynthVoiceContext);
  const value = useM((state) => state.synthSettings[voice][setting]);
  const setSynthParam = useM((state) => state.setSynthParam);
  const options = [-2, -1, 0, 1, 2] as const;
  const style = { "--choice-width": `${synthChoiceWidthCh(options)}ch` } as CSSProperties;
  return (
    <label className="synthchoice synthchoice--octave">
      <span>{label}</span>
      <select aria-label={label} value={value} style={style}
        onChange={(event) => setSynthParam(voice, setting, Number(event.target.value))}>
        {options.map((octave) =>
          <option key={octave} value={octave}>{synthChoiceText(octave)}</option>)}
      </select>
    </label>
  );
}

function Envelope({ title, prefix }: { title: string; prefix: "filter" | "amp" }) {
  const setting = (suffix: string) => `${prefix}${suffix}` as NumberKey;
  return (
    <div className="synthenvelope">
      <strong title={`${title} envelope`}>{title === "Filter" ? "F" : "A"}</strong>
      <Knob label="A" setting={setting("AttackSec")} min={0.003} max={2} step={0.001} unit="s" />
      <Knob label="D" setting={setting("DecaySec")} min={0.003} max={2} step={0.001} unit="s" />
      <Knob label="S" setting={setting("Sustain")} min={0} max={1} step={0.01} />
      <Knob label="R" setting={setting("ReleaseSec")} min={0.015} max={5} step={0.005} unit="s" />
    </div>
  );
}

export function SynthWindow() {
  const settings = useM((state) => state.synthSettings);
  const [voice, setVoice] = useState(0);
  const patch = settings[voice];
  const setSynthParam = useM((state) => state.setSynthParam);

  useEffect(() => {
    getRuntime().setSynthSettings(settings);
  }, [settings]);

  return (
    <SynthVoiceContext.Provider value={voice}>
    <div className={`synthpanel uvoice uvoice--${voice + 1}`}>
      <nav className="synthstreams" aria-label="Synth stream">
        {settings.map((_, index) => (
          <button key={index} type="button" className={`uvoice uvoice--${index + 1}${voice === index ? " is-on" : ""}`}
            aria-pressed={voice === index} aria-label={`Edit Stream ${index + 1} synth`}
            onClick={() => setVoice(index)}>{index + 1}</button>
        ))}
      </nav>
      <section className="synthpanel__section synthpanel__lfo">
        <h3>LFO</h3>
        <div className="synthpanel__knobs synthpanel__knobs--2">
          <Knob label="Rate" setting="lfoRateHz" min={0.05} max={20} step={0.05} unit="Hz" />
          <Knob label="Dep" ariaLabel="LFO depth" setting="lfoDepth" min={0} max={1} step={0.01} />
        </div>
        <Choice label="Wave" ariaLabel="LFO waveform" setting="lfoWaveform" options={SYNTH_WAVEFORMS} />
        <Choice label="To" setting="lfoDestination" options={SYNTH_LFO_DESTINATIONS} />
        <Knob label="Glide" setting="glideSec" min={0} max={1} step={0.005} unit="s" />
      </section>

      <section className="synthpanel__section synthpanel__osc">
        <h3>Oscillators</h3>
        <div className="synthosc">
          <em>1</em>
          <Octave setting="oscillatorOctave" label="Oct" />
          <Knob label="Tune" setting="detuneCents" min={-100} max={100} step={1} unit="¢" />
          <Choice label="Wave" ariaLabel="Oscillator 1 waveform" setting="waveform" options={SYNTH_WAVEFORMS} />
        </div>
        <div className="synthosc">
          <em>2</em>
          <Octave setting="oscillator2Octave" label="Oct" />
          <Knob label="Tune" setting="oscillator2DetuneCents" min={-100} max={100} step={1} unit="¢" />
          <Choice label="Wave" ariaLabel="Oscillator 2 waveform" setting="oscillator2Waveform" options={SYNTH_WAVEFORMS} />
        </div>
        <Choice label="Sub wave" setting="subOscillatorWaveform" options={SYNTH_WAVEFORMS} />
      </section>

      <section className="synthpanel__section synthpanel__mixer">
        <h3>Mixer</h3>
        <div className="synthpanel__knobs synthpanel__knobs--2">
          <Knob label="O1" ariaLabel="Oscillator 1 level" setting="oscillator1Level" min={0} max={1} step={0.01} />
          <Knob label="Sub" setting="subOscillatorLevel" min={0} max={1} step={0.01} />
          <Knob label="O2" ariaLabel="Oscillator 2 level" setting="oscillator2Level" min={0} max={1} step={0.01} />
          <Knob label="Nse" ariaLabel="Noise level" setting="noiseLevel" min={0} max={1} step={0.01} />
        </div>
      </section>

      <section className="synthpanel__section synthpanel__filter">
        <h3>Filter</h3>
        <div className="synthpanel__knobs synthpanel__knobs--2">
          <Knob label="Cut" ariaLabel="Filter cutoff" setting="filterCutoffHz" min={40} max={18000} step={10} unit="Hz" large />
          <Knob label="Env" ariaLabel="Filter envelope amount" setting="filterEnvelopeAmount" min={-1} max={1} step={0.01} />
          <Knob label="Res" ariaLabel="Filter resonance" setting="filterResonance" min={0} max={30} step={0.1} />
          <Knob label="Key" ariaLabel="Filter keyboard tracking" setting="filterKeyboardTracking" min={0} max={1} step={0.01} />
        </div>
        <Choice label="Mode" setting="filterType" options={SYNTH_FILTER_TYPES} />
      </section>

      <section className="synthpanel__section synthpanel__envelopes">
        <h3>Envelopes</h3>
        <Envelope title="Filter" prefix="filter" />
        <Envelope title="Amplifier" prefix="amp" />
      </section>

      <section className="synthpanel__section synthpanel__output">
        <h3>Output</h3>
        <Knob label="Vol" ariaLabel="Volume" setting="masterVolume" min={0} max={1} step={0.01} large />
        <Knob label="Vel" ariaLabel="Velocity" setting="velocitySensitivity" min={0} max={1} step={0.01} />
        <label className="synthpower">
          <input type="checkbox" checked={patch.enabled}
            onChange={(event) => setSynthParam(voice, "enabled", event.target.checked)} />
          <span aria-hidden="true" /> Power
        </label>
      </section>
    </div>
    </SynthVoiceContext.Provider>
  );
}
