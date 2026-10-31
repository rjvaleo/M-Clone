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
import { groupOf, heightOf, type InertControl, type PanelControl, type PanelDisplay, type PanelLayout } from "./layout";
import { arcPath, dragValue, fromFraction, knobAngle, padPoint, padValues, snapStep, toFraction, travelFor, type Travel } from "./travel";
import { cloudGeometry, deleteCloud, insideBox, listClouds, moveTo, recallCloud, saveCloud, spreadTo } from "./grainCloud";
import { readoutText, type Readout } from "./readout";
import { compressorCurve, filterBankResponse, grainWindow, plateEnvelope, PLATE_HIGH_HZ, type FilterBank } from "./displays";
import { DISPLAY_RATE, PLOT_KINDS, kernelValues, place, plotFor, type Pane, type Plot } from "./plots";

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
    width: layout.width, height: heightOf(layout, page),
    ...(layout.accent ? { "--pnl-badge": layout.accent, "--pnl-accent": layout.accent } : {}),
    ...(layout.accentInk ? { "--pnl-badge-ink": layout.accentInk } : {}),
  } as CSSProperties;
  return (
    <div className={`pnl pnl--${layout.style}`} style={style}
      role="group" aria-label={`${module?.label ?? node.moduleType} panel`}>
      {layout.groups.filter((group) => shows(group.page)).map((group) => (
        <div key={group.id} className="pnl-group" data-tint={group.tint} style={box(group)}>
          {group.label && <span className="pnl-group__label">{group.label}</span>}
        </div>
      ))}
      {layout.displays.map((display, index) => shows(display.page) && (
        <div key={`${display.kind}-${index}`} className={`pnl-display pnl-display--${display.kind}${PLOT_KINDS.includes(display.kind) ? " pnl-display--plotted" : ""}`} style={box(display)}>
          <Display display={display} node={node} pages={{ list: layout.pages ?? [], current: page, show: setPage }}
            label={module?.label ?? node.moduleType} setParameter={setParameter} />
        </div>
      ))}
      {layout.controls.filter((control) => shows(control.page)).map((control) => {
        const parameter = parameters.get(control.param);
        if (!parameter) return null;
        return <Control key={`${control.param}-${control.page ?? ""}`} control={control} parameter={parameter} node={node} setParameter={setParameter}
          tint={groupOf(layout, { ...control, page })?.tint} readout={control.readout ?? layout.readout} />;
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
    case "reroll":
      return <ModTarget nodeId={node.id} moduleType={node.moduleType} parameterId={control.param} value={num(value)}>
        {() => <Reroll control={placed} parameter={parameter} value={value} label={label} onChange={onChange} />}
      </ModTarget>;
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
function shown(parameter: ParameterDescriptor, value: JsonValue | undefined, zero?: string, readout?: Readout, text?: (v: number) => string): string {
  if (parameter.kind === "enum") return String(value ?? parameter.defaultValue);
  if (text) return text(num(value, num(parameter.defaultValue)));
  if (zero !== undefined && num(value, num(parameter.defaultValue)) === 0) return zero;
  if (readout) {
    // A whole-number control (a step of exactly 1) prints no places. A
    // logarithmic control's step can be 1 or more without it being whole.
    const whole = parameter.step === 1 && !readout.scale && !readout.ratio;
    return readoutText(num(value, num(parameter.defaultValue)), whole ? { ...readout, decimals: 0, figures: undefined } : readout,
      readout.figures !== undefined ? parameter.unit : undefined);
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
  // A detent catches the value within 6 % of the range (MultiGrainLive's `DETENT_FRAC`).
  const caught = (next: number) => control.detent !== undefined && Math.abs(next - control.detent) <= (max - min) * 0.06 ? control.detent : next;
  const set = (next: number) => onChange(choice ? options[Math.round(next)] ?? options[0] : caught(next));
  const drag = useDrag((_dx, dy, fine, start) =>
    set(dragValue(start, dy, { min, max, travel, step: choice ? 1 : parameter.step }, fine)));
  const pointer = { x: 20 + 11 * Math.sin((angle * Math.PI) / 180), y: 20 - 11 * Math.cos((angle * Math.PI) / 180) };
  const label_ = <span className="pnl-knob__label">{label}</span>;
  const text = shown(parameter, value, control.zero, control.readout, control.text);
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
    onChange(Number((step > 0 ? snapStep(raw, min, step) : raw).toPrecision(12)));
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
    <div {...tinted(control)} className={`pnl-control pnl-select${control.caption ? " pnl-select--captioned" : ""}`} style={box(control)} role="radiogroup" aria-label={label}>
      {control.caption && <span className="pnl-select__caption">{label}</span>}
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
 * MultiGrainLive's Seed row: the number every random choice is drawn from, and
 * Re-roll, which deals a new one as its button does —
 * `(seed · 1664525 + 1013904223) % 2147483647` — so every jitter changes at
 * once and no other setting does.
 */
export const reroll = (seed: number): number => (seed * 1664525 + 1013904223) % 2147483647;

function Reroll({ control, parameter, value, label, onChange }: ControlProps) {
  const current = num(value, num(parameter.defaultValue));
  return (
    <div {...tinted(control)} className="pnl-control pnl-reroll" style={box(control)}
      title="The number every random choice here is drawn from. Re-roll re-deals the whole cloud without moving a single setting.">
      <span className="pnl-knob__label">{label}</span>
      <button type="button" className="pnl-switch pnl-reroll__button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onChange(reroll(current)); }}>
        <span className="pnl-switch__text">Re-roll</span>
      </button>
      <span className="pnl-knob__value">{String(current)}</span>
    </div>
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
      {inert.kind === "switch" || inert.w >= 40 ? <span className="pnl-switch__text">{inert.label}</span> : null}
    </div>
  );
}

// ---- displays ----------------------------------------------------------------

type Pages = { list: readonly { id: string; label: string }[]; current?: string; show: (id: string) => void };

function Display({ display, node, pages, label, setParameter }: { display: PanelDisplay; node: NodeInstance; pages: Pages; label: string; setParameter: Setter }) {
  const p = node.parameters;
  switch (display.kind) {
    case "cloud-pad": return <CloudPad display={display} node={node} setParameter={setParameter} />;
    case "cloud-readout": return <CloudReadout node={node} />;
    case "cloud-presets": return <CloudPresets node={node} setParameter={setParameter} />;
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
    default: return PLOT_KINDS.includes(display.kind) ? <PlotView display={display} node={node} /> : null;
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

/** The sample's length in seconds, from the sound pool. */
function useSeconds(node: NodeInstance): number {
  const { assets } = useSoundPool();
  const id = typeof node.parameters["asset-id"] === "string" ? (node.parameters["asset-id"] as string) : "";
  return assets.find((entry) => entry.id === id)?.durationSec ?? 0;
}

/**
 * MultiGrainLive's cloud pad: the source across with its waveform behind, pitch
 * offset up and down, and the box that is the read head. Drag inside the box
 * to move the head; drag outside it to spray it in time and pitch. The head
 * follows where the engine is reading (`data-cloud-played`, written from the
 * rack's report by `CloudAnimator`).
 */
function CloudPad({ display, node, setParameter }: { display: PanelDisplay; node: NodeInstance; setParameter: Setter }) {
  const { assets } = useSoundPool();
  const id = typeof node.parameters["asset-id"] === "string" ? (node.parameters["asset-id"] as string) : "";
  const asset = assets.find((entry) => entry.id === id);
  const seconds = asset?.durationSec ?? 0;
  const area = useRef<HTMLDivElement>(null);
  const mode = useRef<"move" | "spread" | null>(null);
  const { w, h } = display;
  const played = () => Number(area.current?.dataset.cloudPlayed ?? 0);
  const geo = cloudGeometry(node.parameters, seconds, w, h);
  const apply = (clientX: number, clientY: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect || !seconds) return;
    const now = cloudGeometry(node.parameters, seconds, w, h, played());
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = mode.current === "move" ? moveTo(now, px) : spreadTo(now, px, py, seconds);
    for (const [key, v] of Object.entries(next)) setParameter(key, v);
  };
  return <div ref={area} className="pnl-cloud" data-cloud-node={node.id} data-cloud-start={geo.home + num(node.parameters.position)}
    data-cloud-scan={num(node.parameters.scan, 1)} data-cloud-w={w}
    style={{ "--cloud-head": `${geo.head * w}px` } as CSSProperties}
    title="The grain cloud over the source. Drag the box to move the read head; drag outside it to widen the spray or the pitch scatter."
    onPointerDown={(event) => {
      event.stopPropagation();
      const rect = area.current?.getBoundingClientRect();
      if (!rect) return;
      const now = cloudGeometry(node.parameters, seconds, w, h, played());
      mode.current = insideBox(now, event.clientX - rect.left, event.clientY - rect.top) ? "move" : "spread";
      event.currentTarget.setPointerCapture(event.pointerId);
      apply(event.clientX, event.clientY);
    }}
    onPointerMove={(event) => { if (mode.current) apply(event.clientX, event.clientY); }}
    onPointerUp={() => { mode.current = null; }}>
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {asset && <path className="pnl-screen__trace" d={peaksToPath(asset.peaks, w, h)} />}
      <line className="pnl-cloud__centre" x1="0" y1={h / 2} x2={w} y2={h / 2} />
      {/* Drawn about x = 0 and carried to the head by the animator's --cloud-head. */}
      <g className="pnl-cloud__head">
        <rect className="pnl-cloud__box" x={-geo.halfW} y={h / 2 - geo.halfH} width={geo.halfW * 2} height={geo.halfH * 2} />
        <line className="pnl-cloud__line" x1="0" y1="0" x2="0" y2={h} />
      </g>
    </svg>
  </div>;
}

/** What the pad is reading: the head, in seconds into the file. */
function CloudReadout({ node }: { node: NodeInstance }) {
  const seconds = useSeconds(node);
  if (!seconds) return <span className="pnl-cloud-read">no sample</span>;
  const geo = cloudGeometry(node.parameters, seconds, 1, 1);
  return <span className="pnl-cloud-read" data-cloud-read={node.id} data-cloud-seconds={seconds}
    data-cloud-start={geo.home + num(node.parameters.position)} data-cloud-scan={num(node.parameters.scan, 1)}>
    {`head ${(geo.head * seconds).toFixed(2)}s`}
  </span>;
}

/** Storage for the Cloud presets; none in a private window, and the row then keeps none. */
const cloudStore = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

/**
 * Cloud presets: a picker, Save as… and Delete, as MultiGrainLive's row. A
 * cloud is the grain section alone, put back over the defaults; the sample,
 * the seed and the rest of the engine are left as they are.
 */
function CloudPresets({ node, setParameter }: { node: NodeInstance; setParameter: Setter }) {
  const [, redraw] = useState(0);
  const [picked, setPicked] = useState("");
  const store = cloudStore();
  const names = store ? listClouds(store) : [];
  const defaults = Object.fromEntries((moduleRegistry.get(node.moduleType)?.parameters ?? []).map((p) => [p.id, p.defaultValue]));
  return <div className="pnl-cloud-presets" onPointerDown={(event) => event.stopPropagation()}>
    <span className="pnl-cloud-presets__tag">CLOUD</span>
    <select value={names.includes(picked) ? picked : ""} title="A saved cloud: every grain control, and nothing else. The sound and the seed stay as they are."
      onChange={(event) => {
        const name = event.currentTarget.value;
        setPicked(name);
        const values = store && name ? recallCloud(store, name, defaults) : null;
        if (values) for (const [key, v] of Object.entries(values)) setParameter(key, v);
      }}>
      <option value="">— none —</option>
      {names.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <button type="button" title="Keep the grain controls as they are now, under a name." onClick={() => {
      if (!store) return;
      const name = window.prompt("Save this cloud as:", picked || `Cloud ${names.length + 1}`);
      if (name === null) return;
      const stored = saveCloud(store, name, node.parameters);
      if (stored) { setPicked(stored); redraw((n) => n + 1); }
    }}>Save as…</button>
    <button type="button" title="Forget the cloud named in the picker. The sound is not touched." onClick={() => {
      if (!store || !picked) return;
      if (!window.confirm(`Delete the cloud “${picked}”? The sound is left as it is.`)) return;
      deleteCloud(store, picked);
      setPicked("");
      redraw((n) => n + 1);
    }}>Delete</button>
  </div>;
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

// ---- the ported effects' plots -------------------------------------------------

/** A plot from plots.ts, drawn: its panes stacked, its two lines of text above and below. */
function PlotView({ display, node }: { display: PanelDisplay; node: NodeInstance }) {
  const { assets } = useSoundPool();
  const module = moduleRegistry.get(node.moduleType);
  const id = typeof node.parameters["asset-id"] === "string" ? (node.parameters["asset-id"] as string) : "";
  const asset = assets.find((entry) => entry.id === id);
  const plot = plotFor(display.kind, kernelValues(module?.parameters ?? [], node.parameters),
    { rate: DISPLAY_RATE, sound: asset ? { name: asset.name, durationSec: asset.durationSec } : undefined });
  if (!plot) return null;
  return <PlotSvg plot={plot} w={display.w} h={display.h} nodeId={node.id} />;
}

/** Room at a display's right edge for its IN and OUT bars. */
const METER_W = 13;

/**
 * Every ported effect is metered by the engine (engineBridge `isMetered`), so
 * every plot carries the module's IN and OUT bars down its right edge; the
 * meter animator (meters.ts) fills them from the rack's reports.
 */
function PlotSvg({ plot, w, h, nodeId }: { plot: Plot; w: number; h: number; nodeId: string }) {
  // A short display, as the strips' are, gives its two lines less room.
  // An empty bottom line is left out and its room given to the panes.
  const text = h < 120 ? 13 : 16;
  const below = plot.bottom ? text : 2;
  const paneH = (h - text - below) / plot.panes.length;
  return <>
    <span className="pnl-screen__top">{plot.top}</span>
    <svg className="pnl-plot" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {plot.panes.map((pane, i) => {
        const box = { x: 30, y: text + i * paneH + 2, w: w - 38 - METER_W, h: paneH - 15 };
        const side = Math.min(box.w, box.h);
        return <PaneSvg key={i} pane={pane} nodeId={nodeId}
          box={pane.square ? { x: box.x + (box.w - side) / 2, y: box.y + (box.h - side) / 2, w: side, h: side } : box} />;
      })}
    </svg>
    <div className="pnl-meter" style={{ top: text + 2, bottom: below + 13 }} title="Level in and out, peak, −60 to 0 dBFS">
      <span className="pnl-meter__bar" data-level-node={nodeId} data-level-side="in" data-live="off" />
      <span className="pnl-meter__bar" data-level-node={nodeId} data-level-side="out" data-live="off" />
    </div>
    {plot.bottom && <span className="pnl-screen__bottom">{plot.bottom}</span>}
  </>;
}

/** The ticks whose labels have room: each at least `room` px past the last one kept. */
function spaced<T extends { label: string }>(ticks: T[], at: (t: T) => number, room: (t: T) => number): T[] {
  let last = -Infinity;
  return ticks.filter((t) => {
    if (t.label === "" || Math.abs(at(t) - last) < room(t)) return false;
    last = at(t);
    return true;
  });
}

/** A path through points, broken where a y is not a number. */
function pathOf(points: [number, number][], at: (p: [number, number]) => [number, number]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (Number.isNaN(p[1])) { pen = false; continue; }
    const [x, y] = at(p);
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

function PaneSvg({ pane, box, nodeId }: { pane: Pane; box: { x: number; y: number; w: number; h: number }; nodeId: string }) {
  const px = (v: number) => box.x + place(pane.x, v) * box.w;
  const py = (v: number) => box.y + box.h - place(pane.y, v) * box.h;
  const at = ([x, y]: [number, number]): [number, number] => [px(x), py(y)];
  const base = pane.y.min < 0 && pane.y.max > 0 ? 0 : pane.y.min;
  return <g>
    {pane.x.ticks.map((t) => <path key={`x${t.at}`} className="pnl-plot__grid" d={`M${px(t.at).toFixed(1)} ${box.y}V${box.y + box.h}`} />)}
    {pane.y.ticks.map((t) => <path key={`y${t.at}`} className="pnl-plot__grid" d={`M${box.x} ${py(t.at).toFixed(1)}H${box.x + box.w}`} />)}
    {spaced(pane.x.ticks, (t) => px(t.at), (t) => t.label.length * 5.5 + 4).map((t) =>
      <text key={`xl${t.at}`} className="pnl-plot__tick" x={px(t.at)} y={box.y + box.h + 10} textAnchor="middle">{t.label}</text>)}
    {spaced(pane.y.ticks, (t) => -py(t.at), () => 10).map((t) =>
      <text key={`yl${t.at}`} className="pnl-plot__tick" x={box.x - 4} y={py(t.at) + 3} textAnchor="end">{t.label}</text>)}
    {pane.title && <text className="pnl-plot__title" x={box.x + 4} y={box.y + 10}>{pane.title}</text>}
    {(pane.rules ?? []).map((r, i) => <path key={`r${i}`} className={`pnl-plot__rule pnl-tone-${r.tone}`}
      d={r.x !== undefined ? `M${px(r.x).toFixed(1)} ${box.y}V${box.y + box.h}` : `M${box.x} ${py(r.y ?? 0).toFixed(1)}H${box.x + box.w}`} />)}
    {pane.traces.map((t, i) => <g key={`t${i}`}>
      {t.fill && <path className={`pnl-plot__area pnl-tone-${t.tone}`}
        d={`${pathOf(t.points, at)}L${px(t.points[t.points.length - 1][0]).toFixed(1)} ${py(base).toFixed(1)}L${px(t.points[0][0]).toFixed(1)} ${py(base).toFixed(1)}Z`} />}
      <path className={`pnl-plot__trace pnl-tone-${t.tone}${t.dash ? " is-dashed" : ""}`} d={pathOf(t.points, at)} />
    </g>)}
    {(pane.stems ?? []).map((s, i) => <path key={`s${i}`} className={`pnl-plot__stem pnl-tone-${s.tone}`}
      d={`M${px(s.x).toFixed(1)} ${py(base).toFixed(1)}V${py(s.y).toFixed(1)}`} />)}
    {(pane.dots ?? []).map((d, i) => <g key={`d${i}`}>
      <circle className={`pnl-plot__dot pnl-tone-${d.tone}${d.hollow ? " is-hollow" : ""}`} cx={px(d.x)} cy={py(d.y)} r={d.hollow ? 3 : 3.5} />
      {d.label && <text className={`pnl-plot__label pnl-tone-${d.tone}`} x={px(d.x) + 5} y={py(d.y) - 5}>{d.label}</text>}
    </g>)}
    {/* The measured level in and out, placed by the meter animator. */}
    {pane.live && <circle className="pnl-plot__live" r="5" visibility="hidden" data-level-dot="" data-level-node={nodeId}
      data-x0={box.x} data-xw={box.w} data-xmin={pane.x.min} data-xmax={pane.x.max}
      data-y0={box.y} data-yh={box.h} data-ymin={pane.y.min} data-ymax={pane.y.max} />}
  </g>;
}
