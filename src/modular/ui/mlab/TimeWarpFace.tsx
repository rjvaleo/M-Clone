/**
 * M Time Warp's face: Numerology's CV Sequencer (ModulationSeq, manual p140)
 * drawing one voice's Time Distortion. Each step's diamond says how early or
 * late that step lands, as a share of a step; the line between them is the
 * curve. Step 1 is fixed, as on the Groove Clock, so the cycle still starts
 * on time and lasts exactly as long. The end marker sets the cycle's length;
 * Position a–f is M's six Time Distortion positions.
 */

import { useRef } from "react";
import { AdvancedPanel, ButtonRow, N4Body, N4Box, N4Button, N4Knob, N4Panel, N4Spinner, StepLabels, VISIBLE_STEPS } from "../n4/kit";
import { applyRowAction, laneValueFromY, moveSelected, stepFromX } from "../n4/logic";
import { MAX_WARP_OFFSET, defaultWarpBanks, invertWarp, setWarpOffset, zeroWarp, type WarpBank } from "../../mlab/warpSteps";
import { Rng } from "../../../engine/rng";
import { PositionButtons, param, type MLabFaceProps } from "./common";

const DENOMINATORS = [[4, "1/4"], [8, "1/8"], [16, "16th"], [32, "32nd"]] as const;

export function TimeWarpFace({ node, setParameter, setParameters }: MLabFaceProps) {
  const banks = param<WarpBank[]>(node, "banks", defaultWarpBanks());
  const position = Math.round(param(node, "position", 0));
  const bank = banks[position] ?? defaultWarpBanks()[0];
  const select = param<boolean[]>(node, "select", []);
  const w = { first: 0, count: VISIBLE_STEPS };
  const writeBank = (next: WarpBank) => {
    const all = banks.map((b) => b);
    all[position] = next;
    setParameter("banks", all as never);
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
    const value = laneValueFromY(y, element.offsetHeight, -MAX_WARP_OFFSET, MAX_WARP_OFFSET, 0.01);
    const offsets = Array.from({ length: Math.max(bank.offsets.length, step + 1) }, (_, i) => bank.offsets[i] ?? 0);
    const moved = moveSelected(offsets, select, step, value, -MAX_WARP_OFFSET, MAX_WARP_OFFSET);
    moved[0] = 0;
    writeBank(setWarpOffset({ ...bank, offsets: moved }, step, moved[step]));
  };
  const height = 150;
  const yOf = (v: number) => (1 - (v + MAX_WARP_OFFSET) / (2 * MAX_WARP_OFFSET)) * height;
  const points = Array.from({ length: Math.min(bank.length, VISIBLE_STEPS) }, (_, i) => ({ i, v: bank.offsets[i] ?? 0 }));

  return (
    <N4Panel accent="blue" wide>
      <N4Body
        left={<>
          <N4Box>
            <N4Spinner label="Rate" value={bank.denominator} options={DENOMINATORS.map(([value, label]) => ({ value, label }))}
              onChange={(denominator) => writeBank({ ...bank, denominator })} />
          </N4Box>
          <N4Box title="Position">
            <PositionButtons value={position} label="Time Distortion position" onPick={(p) => setParameter("position", p)} />
          </N4Box>
          <N4Box className="n4-box--centred">
            <N4Knob label="Amount" value={param(node, "amount", 1)} min={0} max={1} onChange={(v) => setParameter("amount", v)}
              format={(v) => `${Math.round(v * 100)}%`} />
          </N4Box>
        </>}
        right={<>
          <div className="n4-line n4-line--centre">
            <N4Button onClick={() => writeBank({ ...bank, offsets: [0, ...bank.offsets.slice(2, bank.length), bank.offsets[1] ?? 0, ...bank.offsets.slice(bank.length)] })}>&lt;&lt;</N4Button>
            <N4Button onClick={() => writeBank({ ...bank, offsets: [0, bank.offsets[bank.length - 1] ?? 0, ...bank.offsets.slice(1, bank.length - 1), ...bank.offsets.slice(bank.length)] })}>&gt;&gt;</N4Button>
          </div>
          <N4Button onClick={() => writeBank(zeroWarp(bank))}>Zero All</N4Button>
          <N4Button onClick={() => writeBank(invertWarp(bank))}>Invert</N4Button>
          <N4Box title="Range" className="n4-box--centred"><span>±{MAX_WARP_OFFSET} step</span></N4Box>
        </>}>
        <div className="n4-rowgrid">
          <span className="n4-spacer" />
          <StepLabels window={w} start={0} end={bank.length - 1} playing={-1} fixedFirst
            onEnd={(step) => writeBank({ ...bank, length: Math.max(1, step + 1) })} />
          <span className="n4-spacer" />
          <ButtonRow label="Sel" kind="select" flags={select} window={w}
            onToggle={(s) => { const next = [...select]; next[s] = !next[s]; setParameter("select", next); }}
            onAction={(action, on) => setParameter("select", applyRowAction(Array.from({ length: bank.length }, (_, i) => select[i] === true), action, on,
              { from: 0, to: bank.length - 1 }, new Rng((Math.random() * 0x7fffffff) >>> 0)))}
            onClear={() => setParameter("select", [])} />
          <span className="n4-spacer" />
          <div ref={lane} className="n4-cvlane" data-n4-control="true"
            onPointerDown={(event) => {
              event.stopPropagation();
              draw(event.clientX, event.clientY);
              const move = (e: PointerEvent) => draw(e.clientX, e.clientY);
              const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}>
            <svg viewBox={`0 0 ${VISIBLE_STEPS * 10} ${height}`} preserveAspectRatio="none" aria-label="Time Distortion offsets">
              <line className="n4-cvlane__grid" x1={0} x2={VISIBLE_STEPS * 10} y1={yOf(0)} y2={yOf(0)} />
              <polyline points={points.map(({ i, v }) => `${i * 10 + 5},${yOf(v)}`).join(" ")} vectorEffect="non-scaling-stroke" />
            </svg>
            {points.map(({ i, v }) => (
              <span key={i} className={`n4-cvlane__diamond${select[i] ? " is-selected" : ""}`}
                style={{ left: `${((i + 0.5) / VISIBLE_STEPS) * 100}%`, top: `${(yOf(v) / height) * 100}%` }} />
            ))}
          </div>
          <span className="n4-spacer" />
          <span className="n4-spacer" />
          <div className="n4-lane__values">
            {Array.from({ length: VISIBLE_STEPS }, (_, i) => (
              <span key={i}>{i >= bank.length ? "" : i === 0 ? "Fixed" : (bank.offsets[i] ?? 0).toFixed(2)}</span>
            ))}
          </div>
          <span className="n4-spacer" />
        </div>
      </N4Body>
      <AdvancedPanel open={node.parameters.advanced === true} onToggle={() => setParameter("advanced", node.parameters.advanced !== true)}>
        <span className="n4-muted">Length: {bank.length} steps of 1/{bank.denominator} — one cycle of the map, which then repeats.</span>
        <N4Button onClick={() => setParameters({ banks: banks.map((b, i) => (i === position ? b : structuredClone(bank))) as never })}>Copy to all positions</N4Button>
      </AdvancedPanel>
    </N4Panel>
  );
}
