/**
 * M Time Warp's face: a CV Sequencer drawing one voice's Time Distortion,
 * for when it is patched in from outside a NoteSeq (each NoteSeq also keeps
 * its own Warp lane). One strip of controls — Rate, Position a–f, Amount,
 * the shift and reset actions — over one lane of diamonds joined by the
 * curve. A step's diamond says how early or late it lands; step 1 is fixed,
 * so the cycle starts on time and lasts exactly as long.
 */

import { useRef } from "react";
import { N4Button, N4Panel, N4Slider, N4Spinner, StepLabels, VISIBLE_STEPS } from "../n4/kit";
import { laneValueFromY, stepFromX } from "../n4/logic";
import { MAX_WARP_OFFSET, defaultWarpBanks, invertWarp, setWarpOffset, zeroWarp, type WarpBank } from "../../mlab/warpSteps";
import { shiftSteps } from "../../mlab/noteSeq";
import { param, usePresets, type MLabFaceProps } from "./common";
import { PresetSlots } from "../n4/PresetManager";
import { POSITION_LABELS } from "../../mlab/model";

const DENOMINATORS = [[4, "1/4"], [8, "1/8"], [16, "16th"], [32, "32nd"]] as const;
const HEIGHT = 110;

export function TimeWarpFace({ node, setParameter, setParameters }: MLabFaceProps) {
  const presets = usePresets(node, setParameters);
  const banks = param<WarpBank[]>(node, "banks", defaultWarpBanks());
  const position = Math.round(param(node, "position", 0));
  const bank = banks[position] ?? defaultWarpBanks()[0];
  const w = { first: 0, count: VISIBLE_STEPS };
  const writeBank = (next: WarpBank) => {
    const all = banks.map((b) => b);
    all[position] = next;
    setParameter("banks", all as never);
  };
  // << and >> roll steps 2 onward; step 1 stays where the cycle begins.
  const shift = (by: -1 | 1) => {
    const tail = shiftSteps(bank.offsets.slice(1), bank.length - 1, by);
    writeBank({ ...bank, offsets: [0, ...tail] });
  };
  const lane = useRef<HTMLDivElement | null>(null);
  const draw = (clientX: number, clientY: number) => {
    const element = lane.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * element.offsetWidth;
    const y = ((clientY - rect.top) / rect.height) * element.offsetHeight;
    const step = stepFromX(x, element.offsetWidth, VISIBLE_STEPS);
    if (step === 0 || step >= bank.length) return;
    writeBank(setWarpOffset(bank, step, laneValueFromY(y, element.offsetHeight, -MAX_WARP_OFFSET, MAX_WARP_OFFSET, 0.01)));
  };
  const yOf = (v: number) => (1 - (v + MAX_WARP_OFFSET) / (2 * MAX_WARP_OFFSET)) * HEIGHT;
  const points = Array.from({ length: Math.min(bank.length, VISIBLE_STEPS) }, (_, i) => ({ i, v: bank.offsets[i] ?? 0 }));

  return (
    <N4Panel accent="blue" wide>
      <div className="n4-strip">
        <N4Spinner label="Rate" value={bank.denominator} options={DENOMINATORS.map(([value, label]) => ({ value, label }))}
          onChange={(denominator) => writeBank({ ...bank, denominator })} />
        <N4Spinner label="Pos" value={position} options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))}
          onChange={(p) => setParameter("position", p)} />
        <PresetSlots handlers={presets} />
        <div className="n4-strip__grow"><N4Slider label="Amount" value={param(node, "amount", 1)} min={0} max={1}
          onChange={(v) => setParameter("amount", v)} format={(v) => `${Math.round(v * 100)}%`} /></div>
        <N4Button small onClick={() => shift(-1)} title="Shift left">&lt;&lt;</N4Button>
        <N4Button small onClick={() => shift(1)} title="Shift right">&gt;&gt;</N4Button>
        <N4Button small onClick={() => writeBank(zeroWarp(bank))}>Zero</N4Button>
        <N4Button small onClick={() => writeBank(invertWarp(bank))}>Invert</N4Button>
      </div>
      <div className="n4-centre">
        <StepLabels window={w} start={0} end={bank.length - 1} playing={-1} fixedFirst
          onEnd={(step) => writeBank({ ...bank, length: Math.max(1, step + 1) })} />
        <div ref={lane} className="n4-cvlane" style={{ height: HEIGHT }} data-n4-control="true"
          onPointerDown={(event) => {
            event.stopPropagation();
            draw(event.clientX, event.clientY);
            const move = (e: PointerEvent) => draw(e.clientX, e.clientY);
            const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}>
          <svg viewBox={`0 0 ${VISIBLE_STEPS * 10} ${HEIGHT}`} preserveAspectRatio="none" aria-label="Time Distortion offsets">
            <line className="n4-cvlane__grid" x1={0} x2={VISIBLE_STEPS * 10} y1={yOf(0)} y2={yOf(0)} vectorEffect="non-scaling-stroke" />
            <polyline points={points.map(({ i, v }) => `${i * 10 + 5},${yOf(v)}`).join(" ")} vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map(({ i, v }) => (
            <span key={i} className={`n4-cvlane__diamond${i === 0 ? " is-fixed" : ""}`}
              style={{ left: `${((i + 0.5) / VISIBLE_STEPS) * 100}%`, top: `${(yOf(v) / HEIGHT) * 100}%` }} />
          ))}
        </div>
        <div className="n4-lane__values">
          {Array.from({ length: VISIBLE_STEPS }, (_, i) => (
            <span key={i}>{i >= bank.length ? "" : i === 0 ? "Fixed" : (bank.offsets[i] ?? 0).toFixed(2)}</span>
          ))}
        </div>
      </div>
    </N4Panel>
  );
}
