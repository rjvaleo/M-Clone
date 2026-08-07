/**
 * Layout: the part of a panel that is not a control.
 *
 * `reference/panels/CATALOG.md`'s second pass found that the arrangement of
 * controls is as consistent across the sources as the controls themselves,
 * and follows rules none of the panels state. Three of those rules are
 * structural enough to build rather than describe:
 *
 *   - **Rule A — the group is the unit.** No panel presents a flat field of
 *     knobs; every one partitions into named groups, using one of four
 *     naming devices. `Group` is those four.
 *   - **Rule B — order is fixed by signal flow.** `AdsrGroup` maps over
 *     `ADSR_ORDER` rather than accepting four controls in an arbitrary
 *     sequence, so the order cannot be got wrong at a call site.
 *   - **Rule C — size encodes priority.** `FilterGroup` draws cutoff
 *     visibly larger than resonance, the way every filter section in the
 *     catalogue does. Nothing else marks which knob you reach for first.
 *
 * Unlike a control, layout is not themed per kit. A section header is a
 * header in all six kits — what changes inside it is the controls, which are
 * already kit-aware. Giving layout its own six renderings would multiply the
 * surface without making the kits any more distinct.
 */

import type { ReactNode } from "react";
import { Knob } from "./controls/Knob";
import { Slider } from "./controls/Slider";
import { Envelope } from "./controls/Envelope";
import { Selector } from "./controls/Selector";
import { ADSR_ORDER, adsrStages, withAdsrStage, type AdsrStageKey } from "./groups";
import type { EnvelopeShape } from "./geometry";
import type { SelectorOption } from "./types";

export interface GroupProps {
  title: string;
  /**
   * - `bar`: a filled header bar above the group, accent caps. TR-909.
   * - `framed`: a bordered plate with the title in its top-left. Mimic.
   * - `plate`: the name below the group it labels. Vermona drumDING.
   */
  variant?: "bar" | "framed" | "plate";
  children: ReactNode;
}

const HEADING: React.CSSProperties = {
  font: '700 9.5px/1 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: ".1em",
  textTransform: "uppercase",
};

const CONTENT: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: "14px 16px",
};

export function Group({ title, variant = "bar", children }: GroupProps) {
  if (variant === "framed") {
    return (
      <section
        style={{
          border: "1px solid var(--mm-border, rgba(255,255,255,.14))",
          borderRadius: 8,
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h4 style={{ ...HEADING, margin: 0, color: "var(--mm-muted, #8a97a0)" }}>{title}</h4>
        <div style={CONTENT}>{children}</div>
      </section>
    );
  }

  if (variant === "plate") {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={CONTENT}>{children}</div>
        <div
          style={{
            ...HEADING,
            textAlign: "center",
            borderRadius: 3,
            padding: "3px 8px",
            background: "var(--mm-text, #e7ecef)",
            color: "var(--mm-surface, #14181c)",
          }}
        >
          {title}
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div
        style={{
          ...HEADING,
          padding: "4px 8px",
          borderRadius: 2,
          background: "var(--mm-surface-2, #1a1f24)",
          color: "var(--mm-accent, #5fd0c2)",
          // Rule A: the bar spans exactly its group, so a wider group gets a
          // wider bar — which is how TR-909 makes group boundaries readable
          // without drawing a single box.
          alignSelf: "stretch",
        }}
      >
        {title}
      </div>
      <div style={CONTENT}>{children}</div>
    </section>
  );
}

export interface AdsrGroupProps {
  value: EnvelopeShape;
  onChange: (value: EnvelopeShape) => void;
  /** `knobs` is Bitwig's and CR8's row; `sliders` is Mimic's short vertical
   * bank. Both are attested; neither is more correct. */
  variant?: "knobs" | "sliders";
  /** Draw the resulting shape above the bank. The catalogue shows envelopes
   * both with and without a picture beside the controls. */
  showShape?: boolean;
  label?: string;
}

/**
 * An envelope bank in fixed A-D-S-R order.
 *
 * The order comes from `ADSR_ORDER` rather than from this file, so it is one
 * constant with one test rather than a sequence typed out per call site.
 */
export function AdsrGroup({ value, onChange, variant = "knobs", showShape = true, label }: AdsrGroupProps) {
  const stages = adsrStages(value);
  const set = (key: AdsrStageKey) => (next: number) => onChange(withAdsrStage(value, key, next));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {showShape && <Envelope value={value} label={label} width={148} height={44} />}
      <div style={{ display: "flex", alignItems: "flex-end", gap: variant === "knobs" ? 12 : 9 }}>
        {stages.map((stage) =>
          variant === "knobs" ? (
            <Knob
              key={stage.key}
              value={stage.value}
              min={0}
              max={1}
              step={0.01}
              size={36}
              label={stage.short}
              onChange={set(stage.key)}
            />
          ) : (
            <div key={stage.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Slider value={stage.value} min={0} max={1} step={0.01} length={62} onChange={set(stage.key)} />
              <small style={{ font: '600 9px/1 ui-sans-serif, sans-serif', color: "var(--mm-muted, #8a97a0)" }}>
                {stage.short}
              </small>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export interface FilterGroupProps {
  cutoff: number;
  resonance: number;
  onCutoff: (value: number) => void;
  onResonance: (value: number) => void;
  /** Optional third stage. Present in Mimic and CR8, absent in most hardware. */
  drive?: number;
  onDrive?: (value: number) => void;
  /** Filter type, if the panel offers one. */
  type?: string;
  types?: readonly SelectorOption[];
  onType?: (value: string) => void;
  title?: string;
}

/**
 * Cutoff, resonance, and optionally drive — in that order, with cutoff drawn
 * larger.
 *
 * Rule C from the catalogue: the dominant parameter of a group is drawn
 * bigger, and nothing else marks it. Cutoff is the one you sweep; resonance
 * is the one you set once. Drawing them the same size is technically
 * accurate and practically wrong.
 */
export function FilterGroup(props: FilterGroupProps) {
  const { types, type, onType } = props;
  return (
    <Group title={props.title ?? "Filter"} variant="framed">
      {types && type !== undefined && onType && (
        <Selector options={types} value={type} variant="segmented" label="Type" onChange={onType} />
      )}
      <Knob value={props.cutoff} min={0} max={100} size={52} label="Cutoff" onChange={props.onCutoff} />
      <Knob value={props.resonance} min={0} max={100} size={34} label="Res" onChange={props.onResonance} />
      {props.drive !== undefined && props.onDrive && (
        <Knob value={props.drive} min={0} max={100} size={34} label="Drive" onChange={props.onDrive} />
      )}
    </Group>
  );
}

export { ADSR_ORDER };
