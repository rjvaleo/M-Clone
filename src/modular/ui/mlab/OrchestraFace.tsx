/**
 * M Orchestra's face, laid out as a Numerology MatrixSeq's note rows (manual
 * p127): one row per MIDI channel with its M (mute) button, a column per
 * voice — a lit cell sends that voice on that channel — and the channel's
 * Sound Choice program at the end of its row. Orchestration and Sound Choice
 * each have M's six Positions a–f.
 */

import { MAX_VOICES, defaultOrchestration, defaultPrograms } from "../../mlab/model";
import { parseProgram, setProgram, shownProgram, toggleChannel } from "../../mlab/orchestraEdit";
import { N4Body, N4Box, N4Button, N4Panel, N4Spinner } from "../n4/kit";
import { PositionButtons, param, type MLabFaceProps } from "./common";

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);
const VOICES = Array.from({ length: MAX_VOICES }, (_, v) => v);

export function OrchestraFace({ node, setParameter }: MLabFaceProps) {
  const position = Math.round(param(node, "position", 0));
  const soundPosition = Math.round(param(node, "sound-position", 0));
  const orchestration = param<number[][][]>(node, "orchestration", defaultOrchestration());
  const programs = param<(number | null)[][]>(node, "programs", defaultPrograms());
  const numbering = param(node, "program-numbering", "1-128");
  const muted = param<boolean[]>(node, "muted", Array(16).fill(false));

  return (
    <N4Panel accent="red" wide>
      <N4Body
        left={<>
          <N4Box title="Orchestration">
            <PositionButtons label="Orchestration position" value={position} onPick={(p) => setParameter("position", p)} />
          </N4Box>
          <N4Box title="Sound Choice">
            <PositionButtons label="Sound Choice position" value={soundPosition} onPick={(p) => setParameter("sound-position", p)} />
          </N4Box>
          <N4Box>
            <N4Spinner label="Programs" value={numbering}
              options={[{ value: "1-128", label: "1–128" }, { value: "0-127", label: "0–127" }]}
              onChange={(v) => setParameter("program-numbering", v)} />
          </N4Box>
          <N4Button onClick={() => setParameter("muted", Array(16).fill(false))}>Unmute All</N4Button>
        </>}>
        <div className="n4-matrix" role="grid" aria-label="Voices to channels">
          <div className="n4-matrix__row">
            <span />
            <span />
            {VOICES.map((v) => <span key={v} className="n4-matrix__head">V{v + 1}</span>)}
            <span className="n4-matrix__head">Program</span>
          </div>
          {CHANNELS.map((channel) => (
            <div key={channel} className={`n4-matrix__row${muted[channel - 1] ? " is-muted" : ""}`} role="row">
              <span>Ch {channel}</span>
              <N4Button small on={muted[channel - 1] === true}
                onClick={() => setParameter("muted", CHANNELS.map((c) => (c === channel ? !muted[c - 1] : muted[c - 1] === true)))}
                title="Mute this channel">M</N4Button>
              {VOICES.map((v) => {
                const on = (orchestration[position]?.[v] ?? []).includes(channel);
                return (
                  <button type="button" key={v} className={`n4-matrix__cell${on ? " is-on" : ""}`} aria-pressed={on}
                    aria-label={`Voice ${v + 1} on channel ${channel}`}
                    onClick={(event) => { event.stopPropagation(); setParameter("orchestration", toggleChannel(orchestration, position, v, channel) as never); }} />
                );
              })}
              <input aria-label={`Channel ${channel} program`} value={shownProgram(programs[soundPosition]?.[channel - 1] ?? null, numbering)}
                placeholder="–"
                onChange={(event) => setParameter("programs",
                  setProgram(programs, soundPosition, channel - 1, parseProgram(event.currentTarget.value, numbering)) as never)} />
            </div>
          ))}
        </div>
      </N4Body>
    </N4Panel>
  );
}
