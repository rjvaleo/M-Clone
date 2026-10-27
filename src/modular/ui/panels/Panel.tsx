// A module drawn from its panel layout.
//
// Every control sits where the layout puts it and sets its parameter the way
// the generic face would: the same values, the same LFO ring (through
// `ModTarget`), the same second pointer the modulation animator moves. What a
// panel adds is position, grouping, a look, and displays computed from the
// effect's own maths (displays.ts).

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { JsonValue, NodeInstance, ParameterDescriptor } from "../../model/graph";
import { moduleRegistry } from "../../registry/registry";
import { ModTarget } from "../ModTarget";
import { AssetSlot, noteName, useSoundPool } from "../PercussionSlots";
import { formatValue } from "../n4/format";
import { peaksToPath } from "../../audio/waveform";
import { groupOf, type InertControl, type PanelControl, type PanelDisplay, type PanelLayout } from "./layout";
import { arcPath, dragValue, fromFraction, knobAngle, padPoint, padValues, toFraction, travelFor, type Travel } from "./travel";
import { readoutText, type Readout } from "./readout";
import { compressorCurve, filterBankResponse, grainWindow, plateEnvelope, PLATE_HIGH_HZ, type FilterBank } from "./displays";

type Setter = (id: string, value: JsonValue) => void;

const box = (b: { x: number; y: number; w: number; h: number }): CSSProperties =>
  ({ left: b.x, top: b.y, width: b.w, height: b.h });

/** A control's group colour, for the stylesheet. */
const tinted = (control: { tint?: string }) => (control.tint ? { "data-tint": control.tint } : {});

const num = (value: JsonValue | undefined, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The travel a control turns with: its own, else the parameter's. */
const travelOf = (control: PanelControl, parameter: ParameterDescriptor): Travel => control.travel ?? travelFor(parameter);

export function Panel({ layout, node, setParameter }: { layout: PanelLayout; node: NodeInstance; setParameter: Setter }) {
  const module = moduleRegistry.get(node.moduleType);
  const parameters = new Map((module?.parameters ?? []).map((p) => [p.id, p]));
  // Which page is showing is a view of the module, not its sound: it is not
  // saved, and every panel opens on its first page.
  const [page, setPage] = useState(layout.pages?.[0]?.id);
  const shows = (on?: string) => on === undefined || on === page;
  const style = {
    width: layout.width, height: layout.height,
    ...(layout.accent ? { "--pnl-badge": layout.accent, "--pnl-accent": layout.accent } : {}),
    ...(layout.accentInk ? { "--pnl-badge-ink": layout.accentInk } : {}),
  } as CSSProperties;
  return (
    <div className={`pnl pnl--${layout.style}`} style={style}
      role="group" aria-label={`${module?.label ?? node.moduleType} panel`}>
      {layout.groups.map((group) => (
        <div key={group.id} className="pnl-group" data-tint={group.tint} style={box(group)}>
          {group.label && <span className="pnl-group__label">{group.label}</span>}
        </div>
      ))}
      {layout.displays.map((display, index) => (
        <div key={`${display.kind}-${index}`} className={`pnl-display pnl-display--${display.kind}`} style={box(display)}>
          <Display display={display} node={node} pages={{ list: layout.pages ?? [], current: page, show: setPage }}
            label={module?.label ?? node.moduleType} />
        </div>
      ))}
      {layout.controls.filter((control) => shows(control.page)).map((control) => {
        const parameter = parameters.get(control.param);
        if (!parameter) return null;
        return <Control key={`${control.param}-${control.page ?? ""}`} control={control} parameter={parameter} node={node} setParameter={setParameter}
          tint={groupOf(layout, control)?.tint} readout={control.readout ?? layout.readout} />;
      })}
      {(layout.inert ?? []).filter((inert) => shows(inert.page)).map((inert) => <Inert key={inert.label} inert={inert} />)}
    </div>
  );
}

// ---- controls ----------------------------------------------------------------

function Control({ control, parameter, node, setParameter, tint, readout }: {
  control: PanelControl; parameter: ParameterDescriptor; node: NodeInstance; setParameter: Setter; tint?: string; readout?: Readout;
}) {
  const value = node.parameters[control.param];
  const label = control.label ?? parameter.label;
  const onChange = (next: JsonValue) => setParameter(control.param, next);
  const placed = { ...control, tint, readout };
  switch (control.kind) {
    case "switch":
      return <Switch control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />;
    case "select":
      return control.menu
        ? <Menu control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />
        : <Select control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />;
    case "field":
      return <Field control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />;
    case "pad":
      return <Pad control={placed} node={node} setParameter={setParameter} />;
    case "asset":
      return <div className="pnl-control pnl-asset" style={box(control)}>
        <AssetSlot node={node} parameterId={control.param} setParameter={setParameter} />
      </div>;
    default:
      return <ModTarget nodeId={node.id} moduleType={node.moduleType} parameterId={control.param} value={num(value)}>
        {(modulated) => control.kind === "knob"
          ? <Knob control={placed} parameter={parameter} value={value} label={label} onChange={onChange} modulated={modulated} />
          : control.kind === "readout"
            ? <Readout control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />
            : <Slider control={placed} parameter={parameter} value={value} label={label} onChange={onChange} modulated={modulated} />}
      </ModTarget>;
  }
}

type ControlProps = {
  control: PanelControl & { tint?: string }; parameter: ParameterDescriptor; value: JsonValue | undefined; label: string;
  onChange: (value: JsonValue) => void; modulated?: boolean;
};

/** A drag that started on a control: where, and the value then. */
function useDrag(onMove: (dx: number, dy: number, fine: boolean, start: number) => void) {
  const start = useRef<{ x: number; y: number; value: number } | null>(null);
  return (value: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
      start.current = { x: event.clientX, y: event.clientY, value };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!start.current) return;
      onMove(event.clientX - start.current.x, start.current.y - event.clientY, event.shiftKey, start.current.value);
    },
    onPointerUp: () => { start.current = null; },
  });
}

/** The value shown for a parameter: a choice's name, or the number in its unit. */
function shown(parameter: ParameterDescriptor, value: JsonValue | undefined, zero?: string, readout?: Readout): string {
  if (parameter.kind === "enum") return String(value ?? parameter.defaultValue);
  if (zero !== undefined && num(value, num(parameter.defaultValue)) === 0) return zero;
  if (readout) {
    // A whole-number control (a step of exactly 1) prints no places. A
    // logarithmic control's step can be 1 or more without it being whole.
    const whole = parameter.step === 1 && !readout.scale && !readout.ratio;
    return readoutText(num(value, num(parameter.defaultValue)), whole ? { ...readout, decimals: 0 } : readout);
  }
  return formatValue(num(value, num(parameter.defaultValue)), { unit: parameter.unit, step: parameter.step });
}

function Knob({ control, parameter, value, label, onChange, modulated = false }: ControlProps) {
  const choice = parameter.kind === "enum";
  const options = parameter.options ?? [];
  const min = choice ? 0 : parameter.minimum ?? 0;
  const max = choice ? Math.max(1, options.length - 1) : parameter.maximum ?? 1;
  const travel = choice ? "linear" : travelOf(control, parameter);
  const current = choice ? Math.max(0, options.indexOf(String(value))) : num(value, num(parameter.defaultValue));
  const fraction = toFraction(current, min, max, travel);
  const angle = knobAngle(fraction);
  const set = (next: number) => onChange(choice ? options[Math.round(next)] ?? options[0] : next);
  const drag = useDrag((_dx, dy, fine, start) =>
    set(dragValue(start, dy, { min, max, travel, step: choice ? 1 : parameter.step }, fine)));
  const pointer = { x: 20 + 11 * Math.sin((angle * Math.PI) / 180), y: 20 - 11 * Math.cos((angle * Math.PI) / 180) };
  const label_ = <span className="pnl-knob__label">{label}</span>;
  const text = shown(parameter, value, control.zero, control.readout);
  return (
    <div {...tinted(control)} className={`pnl-control pnl-knob${control.size ? ` pnl-knob--${control.size}` : ""}`} style={box(control)}
      title={`${parameter.label}: ${text}`}>
      <div className="pnl-knob__dial" role="slider" tabIndex={0} aria-label={parameter.label}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={current} aria-valuetext={text}
        {...drag(current)}
        onDoubleClick={() => onChange(parameter.defaultValue)}
        onKeyDown={(event) => {
          const steps = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
          if (steps === 0) return;
          event.preventDefault();
          set(choice ? Math.min(max, Math.max(0, current + steps))
            : fromFraction(fraction + steps * (event.shiftKey ? 0.002 : 0.02), min, max, travel));
        }}>
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle className="pnl-knob__body" cx="20" cy="20" r="16" />
          <path className="pnl-knob__track" d={arcPath(20, 20, 17.5, -135, 135)} />
          <path className="pnl-knob__arc" d={arcPath(20, 20, 17.5, -135, angle)} />
          <line className="pnl-knob__pointer" x1="20" y1="20" x2={pointer.x.toFixed(2)} y2={pointer.y.toFixed(2)} />
          {/* The modulation animator rotates this about (20, 20) while an LFO plays. */}
          {modulated && <line className="n4-knob__mod pnl-knob__mod" x1="20" y1="20" x2="20" y2="6" visibility="hidden" />}
        </svg>
      </div>
      {label_}
      <span className="pnl-knob__value">{text}</span>
      {modulated && <span className="n4-knob__live pnl-knob__live" aria-hidden="true" />}
    </div>
  );
}

function Slider({ control, parameter, value, label, onChange, modulated = false }: ControlProps) {
  const vertical = control.kind === "vslider";
  const min = parameter.minimum ?? 0;
  const max = parameter.maximum ?? 1;
  const travel = travelOf(control, parameter);
  const current = num(value, num(parameter.defaultValue));
  const fraction = toFraction(current, min, max, travel);
  const track = useRef<HTMLDivElement>(null);
  const setFrom = (clientX: number, clientY: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const f = vertical ? 1 - (clientY - rect.top) / rect.height : (clientX - rect.left) / rect.width;
    const raw = fromFraction(f, min, max, travel);
    const step = parameter.step ?? 0;
    onChange(Number((step > 0 ? Math.round(raw / step) * step : raw).toPrecision(12)));
  };
  const dragging = useRef(false);
  return (
    <div {...tinted(control)} className={`pnl-control pnl-slider pnl-slider--${vertical ? "v" : "h"}`} style={box(control)}
      title={`${parameter.label}: ${shown(parameter, value)}`}>
      <span className="pnl-slider__label">{label}{vertical && parameter.unit ? <small> {parameter.unit}</small> : null}</span>
      <div className="pnl-slider__track" ref={track} role="slider" tabIndex={0} aria-label={parameter.label}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={current} aria-valuetext={shown(parameter, value)}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setFrom(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => { if (dragging.current) setFrom(event.clientX, event.clientY); }}
        onPointerUp={() => { dragging.current = false; }}
        onDoubleClick={() => onChange(parameter.defaultValue)}
        style={{ "--pnl-fill": fraction } as CSSProperties}>
        <span className="pnl-slider__fill" />
        <span className="pnl-slider__handle" />
      </div>
      <span className="pnl-slider__value">{vertical
        // A fader is narrow: its number alone, the unit beside its name.
        ? formatValue(current, { step: parameter.step })
        : shown(parameter, value, undefined, control.readout)}</span>
      {modulated && <svg className="pnl-slider__mod" viewBox="0 0 40 40" aria-hidden="true"><line className="n4-knob__mod" x1="20" y1="20" x2="20" y2="6" visibility="hidden" /></svg>}
      {modulated && <span className="n4-knob__live pnl-knob__live" aria-hidden="true" />}
    </div>
  );
}

function Readout({ control, parameter, value, label, onChange }: ControlProps) {
  const min = parameter.minimum ?? 0;
  const max = parameter.maximum ?? 127;
  const current = num(value, num(parameter.defaultValue));
  const drag = useDrag((_dx, dy, fine, start) =>
    onChange(dragValue(start, dy, { min, max, travel: "linear", step: parameter.step ?? 1 }, fine)));
  const text = control.param === "root" ? `${noteName(current)}·${Math.round(current)}` : shown(parameter, value);
  return (
    <div {...tinted(control)} className="pnl-control pnl-readout" style={box(control)} role="slider" tabIndex={0}
      aria-label={parameter.label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={current} aria-valuetext={text}
      title={`${parameter.label}: ${text} — drag up or down`}
      {...drag(current)} onDoubleClick={() => onChange(parameter.defaultValue)}>
      <span className="pnl-readout__label">{label}</span>
      <span className="pnl-readout__value">{text}</span>
    </div>
  );
}

function Switch({ control, parameter, value, label, onChange }: ControlProps) {
  const options = parameter.options ?? [];
  const on = parameter.kind === "enum" ? String(value) === options[1] : value === true;
  const text = control.states ? control.states[on ? 1 : 0] : label;
  return (
    <button type="button" {...tinted(control)} className={`pnl-control pnl-switch${control.size ? ` pnl-switch--${control.size}` : ""}${on ? " is-on" : ""}`} style={box(control)}
      aria-pressed={on} aria-label={parameter.label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onChange(parameter.kind === "enum" ? options[on ? 0 : 1] : !on);
      }}>
      <span className="pnl-switch__lamp" aria-hidden="true" />
      <span className="pnl-switch__text">{text}</span>
    </button>
  );
}

function Select({ control, parameter, value, label, onChange }: ControlProps) {
  const options = parameter.options ?? [];
  const current = String(value ?? parameter.defaultValue);
  return (
    <div {...tinted(control)} className="pnl-control pnl-select" style={box(control)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option} role="radio" aria-checked={option === current}
          className={option === current ? "is-on" : ""}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onChange(option); }}>
          <span className="pnl-switch__lamp" aria-hidden="true" />{option}
        </button>
      ))}
    </div>
  );
}

/** A pop-up menu, as a classic Mac window draws a choice. */
function Menu({ control, parameter, value, label, onChange }: ControlProps) {
  const options = parameter.options ?? [];
  return (
    <label className="pnl-control pnl-menu" style={box(control)} onPointerDown={(event) => event.stopPropagation()}>
      <span className="pnl-field__label">{label}</span>
      <select value={String(value ?? parameter.defaultValue)} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/**
 * A number typed into a box, as Hyperprism's additional settings were: it
 * takes effect on Return or when the box is left, held to the control's range.
 */
function Field({ control, parameter, value, label, onChange }: ControlProps) {
  const current = num(value, num(parameter.defaultValue));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = Number(draft);
    setDraft(null);
    if (!Number.isFinite(typed)) return;
    const min = parameter.minimum ?? -Infinity;
    const max = parameter.maximum ?? Infinity;
    const step = parameter.step ?? 0;
    const snapped = step > 0 ? Math.round(typed / step) * step : typed;
    onChange(Number(Math.min(max, Math.max(min, snapped)).toPrecision(12)));
  };
  return (
    <label className="pnl-control pnl-field" style={box(control)} onPointerDown={(event) => event.stopPropagation()}>
      <span className="pnl-field__label">{label}</span>
      <input inputMode="decimal" value={draft ?? formatValue(current, { step: parameter.step })}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur(); if (event.key === "Escape") setDraft(null); }} />
    </label>
  );
}

/**
 * Hyperprism's blue window: drag anywhere to set both controls at once, the
 * first across the top, the second up the left. Double-click centres it.
 */
function Pad({ control, node, setParameter }: { control: PanelControl & { tint?: string }; node: NodeInstance; setParameter: Setter }) {
  const module = moduleRegistry.get(node.moduleType);
  const xp = module?.parameters.find((p) => p.id === control.param);
  const yp = module?.parameters.find((p) => p.id === control.paramY);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  if (!xp || !yp) return null;
  const axis = (p: ParameterDescriptor) => ({ min: p.minimum ?? 0, max: p.maximum ?? 1, step: p.step });
  const xv = num(node.parameters[xp.id], num(xp.defaultValue));
  const yv = num(node.parameters[yp.id], num(yp.defaultValue));
  const [across, down] = padPoint(xv, yv, axis(xp), axis(yp));
  const set = (clientX: number, clientY: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const [x, y] = padValues((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, axis(xp), axis(yp));
    setParameter(xp.id, x);
    setParameter(yp.id, y);
  };
  return (
    <div {...tinted(control)} className="pnl-control pnl-pad" style={box(control)} ref={area}
      role="group" aria-label={`${xp.label} across, ${yp.label} up`}
      onPointerDown={(event) => { event.stopPropagation(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); set(event.clientX, event.clientY); }}
      onPointerMove={(event) => { if (dragging.current) set(event.clientX, event.clientY); }}
      onPointerUp={() => { dragging.current = false; }}
      onDoubleClick={() => {
        const [x, y] = padValues(0.5, 0.5, axis(xp), axis(yp));
        setParameter(xp.id, x);
        setParameter(yp.id, y);
      }}>
      <span className="pnl-pad__line pnl-pad__line--v" style={{ left: `${across * 100}%` }} />
      <span className="pnl-pad__line pnl-pad__line--h" style={{ top: `${down * 100}%` }} />
      <span className="pnl-pad__dot" style={{ left: `${across * 100}%`, top: `${down * 100}%` }} />
    </div>
  );
}

function Inert({ inert }: { inert: InertControl }) {
  return (
    <div className={`pnl-control pnl-inert pnl-inert--${inert.kind}`} style={box(inert)} title={`${inert.label}: ${inert.why}`}
      aria-disabled="true">
      {inert.kind === "switch" ? <span className="pnl-switch__text">{inert.label}</span> : null}
    </div>
  );
}

// ---- displays ----------------------------------------------------------------

type Pages = { list: readonly { id: string; label: string }[]; current?: string; show: (id: string) => void };

function Display({ display, node, pages, label }: { display: PanelDisplay; node: NodeInstance; pages: Pages; label: string }) {
  const p = node.parameters;
  switch (display.kind) {
    case "page-nav": return <PageNav pages={pages} />;
    case "page-title": return <span className="pnl-pagetitle">{pages.list.find((page) => page.id === pages.current)?.label ?? ""}</span>;
    case "lxp-logo": return <span className="pnl-lxp-logo">lexicon</span>;
    case "lxp-title": return <span className="pnl-lxp-title">{`LXP NATIVE | ${label.replace(/^LXP\s*/i, "").toUpperCase()}`}</span>;
    case "lxp-meters": return <LxpMeters />;
    case "hp-x-axis": return <HpAxis node={node} index={0} />;
    case "hp-y-axis": return <HpAxis node={node} index={1} />;
    case "hp-values": return <HpValues node={node} />;
    case "lxp-rtv": return <span className="pnl-lxp-rtv">{label.replace(/^LXP\s*/i, "").toUpperCase()}</span>;
    case "grain-screen": return <GrainScreen display={display} node={node} />;
    case "root-keys": return <RootKeys display={display} root={num(p.root, 60)} />;
    case "plate-tail": return <PlateTail display={display} node={node} />;
    case "transfer": return <Transfer display={display} node={node} />;
    case "levels": return <Levels display={display} node={node} />;
    case "bank-response": return <BankResponse display={display} node={node} />;
    default: return null;
  }
}

function PageNav({ pages }: { pages: Pages }) {
  return <div className="pnl-pages" role="tablist">
    {pages.list.map((page) => (
      <button type="button" key={page.id} role="tab" aria-selected={page.id === pages.current}
        className={page.id === pages.current ? "is-on" : ""}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); pages.show(page.id); }}>
        <span>{page.label}</span>
      </button>
    ))}
  </div>;
}

/** A pad edge's caption: its control's name, with its low and high limits at the ends. */
function HpAxis({ node, index }: { node: NodeInstance; index: number }) {
  const p = moduleRegistry.get(node.moduleType)?.parameters[index];
  if (!p) return null;
  const caption = p.unit ? `${p.label} (${p.unit})` : p.label;
  // A whole limit prints whole, so −100 fits the narrow box on the left edge.
  const limit = (v: number | undefined) => (Number.isInteger(v ?? 0) ? String(v ?? 0) : formatValue(v ?? 0, { step: p.step }));
  return <div className={`pnl-hp-axis pnl-hp-axis--${index === 0 ? "x" : "y"}`}>
    <span className="pnl-hp-axis__limit">{index === 0 ? limit(p.minimum) : limit(p.maximum)}</span>
    <span className="pnl-hp-axis__name">{caption}</span>
    <span className="pnl-hp-axis__limit">{index === 0 ? limit(p.maximum) : limit(p.minimum)}</span>
  </div>;
}

/** The pad's two values, under it. */
function HpValues({ node }: { node: NodeInstance }) {
  const ps = moduleRegistry.get(node.moduleType)?.parameters ?? [];
  const text = ps.slice(0, 2).map((p, i) => `${i === 0 ? "X" : "Y"} ${shown(p, node.parameters[p.id])}`).join("   ");
  return <span className="pnl-hp-values">{text}</span>;
}

/** The IN and OUT LED bars, drawn as the original's. Dark: idMLab has no level meter for them to read yet. */
function LxpMeters() {
  const scale = ["0", "-3", "-6", "-12", "-18", "-24", "SIG"];
  return <div className="pnl-lxp-meters">
    <div className="pnl-lxp-meters__scale">{scale.map((mark) => <span key={mark}>{mark}</span>)}</div>
    {["IN", "OUT"].map((side) => (
      <div key={side} className="pnl-lxp-meters__bar">
        <div className="pnl-lxp-meters__leds">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>
        <span className="pnl-lxp-meters__name">{side}</span>
      </div>
    ))}
  </div>;
}

function GrainScreen({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const { assets } = useSoundPool();
  const id = typeof node.parameters["asset-id"] === "string" ? (node.parameters["asset-id"] as string) : "";
  const asset = assets.find((entry) => entry.id === id);
  const w = display.w - 8;
  const h = display.h - 30;
  const window = grainWindow({ position: num(node.parameters.position), sprayMs: num(node.parameters["position-jitter"]) }, asset?.durationSec ?? 0);
  return <>
    <span className="pnl-screen__top">{asset ? asset.name.toUpperCase() : "NO SAMPLE"}</span>
    <svg className="pnl-screen__wave" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <rect className="pnl-screen__spray" x={window.from * w} y="0" width={Math.max(1, (window.to - window.from) * w)} height={h} />
      {asset && <path className="pnl-screen__trace" d={peaksToPath(asset.peaks, w, h)} />}
      <line className="pnl-screen__head" x1={window.at * w} y1="0" x2={window.at * w} y2={h} />
    </svg>
    <span className="pnl-screen__bottom">POS {num(node.parameters.position).toFixed(3)} · SPRAY {Math.round(num(node.parameters["position-jitter"]))}MS</span>
  </>;
}

function RootKeys({ display, root }: { display: PanelDisplay; root: number }) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]] as const;
  const pitch = ((Math.round(root) % 12) + 12) % 12;
  const keyW = display.w / 7;
  return <svg width={display.w} height={display.h} viewBox={`0 0 ${display.w} ${display.h}`} aria-hidden="true">
    {whites.map((note, i) => <rect key={note} className={`pnl-key${note === pitch ? " is-root" : ""}`} x={i * keyW} y="0" width={keyW - 1} height={display.h} />)}
    {blacks.map(([note, after]) => <rect key={note} className={`pnl-key pnl-key--black${note === pitch ? " is-root" : ""}`}
      x={(after + 1) * keyW - keyW * 0.3} y="0" width={keyW * 0.6} height={display.h * 0.6} />)}
  </svg>;
}

function PlateTail({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const p = node.parameters;
  const envelope = plateEnvelope({ decay: num(p.decay, 0.5), damping: num(p.damping), predelayMs: num(p.predelayMs) });
  const span = 3;
  const left = 26;
  const w = display.w - left - 6;
  const top = 22;
  // Room beneath for the time ticks, then the legend.
  const h = display.h - top - 34;
  const x = (t: number) => left + (t / span) * w;
  const y = (level: number) => top + h - ((Math.max(-60, 20 * Math.log10(Math.max(level, 1e-6))) + 60) / 60) * h;
  const points = (f: (t: number) => number) => Array.from({ length: 151 }, (_, i) => {
    const t = (i / 150) * span;
    return `${x(t).toFixed(1)} ${y(f(t)).toFixed(1)}`;
  });
  const low = points(envelope.low);
  const fill = `M${left} ${top + h} L${low.join(" L")} L${left + w} ${top + h} Z`;
  const pre = x(num(p.predelayMs) / 1000);
  return <>
    <svg width={display.w} height={display.h} viewBox={`0 0 ${display.w} ${display.h}`} aria-hidden="true">
      {[0, -15, -30, -45, -60].map((db) => <g key={db}>
        <path className="pnl-plot__grid" d={`M${left} ${y(Math.pow(10, db / 20)).toFixed(1)}H${left + w}`} />
        <text className="pnl-plot__tick" x={left - 4} y={y(Math.pow(10, db / 20)) + 3} textAnchor="end">{db}</text>
      </g>)}
      {[0, 1, 2, 3].map((t) => <g key={t}>
        <path className="pnl-plot__grid" d={`M${x(t)} ${top}V${top + h}`} />
        <text className="pnl-plot__tick" x={x(t)} y={top + h + 11} textAnchor="middle">{t}s</text>
      </g>)}
      <path className="pnl-plot__fill" d={fill} />
      <path className="pnl-plot__line pnl-plot__line--high" d={`M${points(envelope.high).join(" L")}`} />
      <path className="pnl-plot__line" d={`M${low.join(" L")}`} />
      <line className="pnl-plot__marker" x1={pre} y1={top} x2={pre} y2={top + h} />
    </svg>
    <span className="pnl-screen__top">RT60 {envelope.rt60 >= 100 ? "∞" : `${envelope.rt60.toFixed(2)}S`} · PRE {Math.round(num(p.predelayMs))}MS</span>
    <span className="pnl-screen__bottom">— LOW  - - {PLATE_HIGH_HZ / 1000}K</span>
  </>;
}

function Transfer({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const p = node.parameters;
  const settings = { thresholdDb: num(p.thresholdDb, -18), ratio: num(p.ratio, 4), kneeDb: num(p.kneeDb, 6) };
  const s = display.w;
  const at = (db: number) => ((db + 60) / 60) * s;
  const curve = Array.from({ length: 121 }, (_, i) => {
    const input = -60 + i * 0.5;
    return `${i === 0 ? "M" : "L"}${at(input).toFixed(1)} ${(s - at(compressorCurve(input, settings))).toFixed(1)}`;
  }).join(" ");
  const grid = Array.from({ length: 11 }, (_, i) => `M${(i * s) / 10} 0V${s}M0 ${(i * s) / 10}H${s}`).join("");
  const tx = at(settings.thresholdDb);
  const ty = s - at(compressorCurve(settings.thresholdDb, settings));
  return <svg width={s} height={display.h} viewBox={`0 0 ${s} ${display.h}`} aria-hidden="true">
    <path className="pnl-plot__grid" d={grid} />
    <line className="pnl-plot__unity" x1="0" y1={s} x2={s} y2="0" />
    <rect className="pnl-plot__knee" x={at(settings.thresholdDb - settings.kneeDb / 2)} y="0" width={(settings.kneeDb / 60) * s} height={s} />
    <path className="pnl-plot__line" d={curve} />
    <circle className="pnl-plot__point" cx={tx} cy={ty} r="6" />
    <text className="pnl-plot__text" x={Math.min(tx + 10, s - 110)} y={Math.min(ty + 16, s - 8)}>{`${settings.thresholdDb.toFixed(0)} dB · ${settings.ratio.toFixed(1)}:1`}</text>
  </svg>;
}

/** Gain reduction the curve takes at each input level, the curve read as a meter. */
function Levels({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const p = node.parameters;
  const settings = { thresholdDb: num(p.thresholdDb, -18), ratio: num(p.ratio, 4), kneeDb: num(p.kneeDb, 6) };
  const inputs = [0, -6, -12, -18, -24, -30, -36];
  const rowH = (display.h - 30) / inputs.length;
  return <>
    <span className="pnl-levels__title">GR AT</span>
    {inputs.map((input, i) => {
      const reduction = compressorCurve(input, settings) - input;
      return <div key={input} className="pnl-levels__row" style={{ top: 22 + i * rowH, height: rowH - 2 }}>
        <span>{input}</span>
        <span className="pnl-levels__bar" style={{ width: `${Math.min(100, (-reduction / 30) * 100)}%` }} />
        <span>{reduction.toFixed(1)}</span>
      </div>;
    })}
  </>;
}

function BankResponse({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const p = node.parameters as unknown as Record<string, JsonValue>;
  const bank = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, typeof value === "boolean" ? (value ? 1 : 0) : num(value)])) as unknown as FilterBank;
  const w = display.w;
  const h = display.h;
  const x = (hz: number) => (Math.log(hz / 20) / Math.log(1000)) * w;
  const y = (db: number) => h / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (h / 2 - 6);
  const curve = Array.from({ length: 201 }, (_, i) => {
    const hz = 20 * Math.pow(1000, i / 200);
    return `${i === 0 ? "M" : "L"}${x(hz).toFixed(1)} ${y(filterBankResponse(hz, bank, 48000)).toFixed(1)}`;
  }).join(" ");
  const decades = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const grid = decades.map((hz) => `M${x(hz).toFixed(1)} 0V${h}`).join("") + [-12, 0, 12].map((db) => `M0 ${y(db)}H${w}`).join("");
  const markers = (["notch", "resonator", "regalia", "damping"] as const).map((stage) => ({ stage, hz: num(p[`${stage}Hz`]) }));
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
    <path className="pnl-plot__grid" d={grid} />
    {markers.map(({ stage, hz }) => <line key={stage} className={`pnl-plot__marker pnl-plot__marker--${stage}`} x1={x(hz)} y1="4" x2={x(hz)} y2={h - 4} />)}
    <path className="pnl-plot__line" d={curve} />
    <text className="pnl-plot__text" x="6" y="14">+24 dB</text>
    <text className="pnl-plot__text" x={w - 6} y={h - 6} textAnchor="end">20 Hz – 20 kHz</text>
  </svg>;
}
