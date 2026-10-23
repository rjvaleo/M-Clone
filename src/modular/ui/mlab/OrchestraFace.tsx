/**
 * M Orchestra's face, as MatrixSeq note rows (manual p127): a row per MIDI
 * channel with its M (mute) button, a column per voice — a lit cell sends
 * that voice on that channel, and carries the voice's number — and the
 * channel's Sound Choice program at the end of the row. Only the voices the
 * canvas plays get a column, as Vosm's mod matrix shows only what is in use.
 */

import { MAX_VOICES, POSITION_LABELS, defaultOrchestration, defaultPrograms } from "../../mlab/model";
import { parseProgram, setProgram, shownProgram, toggleChannel } from "../../mlab/orchestraEdit";
import { M_LAB_TYPES } from "../../registry/mLabModules";
import { N4Button, N4Panel, N4Spinner } from "../n4/kit";
import { param, useMLabHost, usePresets, type MLabFaceProps } from "./common";
import { PresetSlots } from "../n4/PresetManager";

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

export function OrchestraFace({ node, setParameter, setParameters }: MLabFaceProps) {
  const host = useMLabHost();
  const presets = usePresets(node, setParameters);
  const position = Math.round(param(node, "position", 0));
  const soundPosition = Math.round(param(node, "sound-position", 0));
  const orchestration = param<number[][][]>(node, "orchestration", defaultOrchestration());
  const programs = param<(number | null)[][]>(node, "programs", defaultPrograms());
  const numbering = param(node, "program-numbering", "1-128");
  const muted = param<boolean[]>(node, "muted", Array(16).fill(false));
  const seqVoices = host ? Object.values(host.graph.nodes)
    .filter((n) => n.moduleType === M_LAB_TYPES.noteSeq)
    .map((n) => Math.round(Number(n.parameters.voice ?? 1))) : [];
  const voiceCount = Math.max(4, Math.min(MAX_VOICES, Math.max(0, ...seqVoices)));
  const voices = Array.from({ length: voiceCount }, (_, v) => v);
  const columns = `48px 20px repeat(${voiceCount}, 1fr) 56px`;

  return (
    <N4Panel accent="red">
      <div className="n4-strip">
        <N4Spinner label="Orch" value={position} options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))}
          onChange={(p) => setParameter("position", p)} />
        <N4Spinner label="Sound" value={soundPosition} options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))}
          onChange={(p) => setParameter("sound-position", p)} />
        <PresetSlots handlers={presets} />
        <N4Spinner value={numbering} options={[{ value: "1-128", label: "1–128" }, { value: "0-127", label: "0–127" }]}
          onChange={(v) => setParameter("program-numbering", v)} />
      </div>
      <div className="n4-centre">
        <div className="n4-matrix" role="grid" aria-label="Voices to channels">
          <div className="n4-matrix__row" style={{ gridTemplateColumns: columns }}>
            <span />
            <N4Button small onClick={() => setParameter("muted", Array(16).fill(false))} title="Unmute every channel">M</N4Button>
            {voices.map((v) => <span key={v} className={`n4-matrix__head uvoice uvoice--${v + 1}`}>V{v + 1}</span>)}
            <span className="n4-matrix__head">Program</span>
          </div>
          {CHANNELS.map((channel) => (
            <div key={channel} className={`n4-matrix__row${muted[channel - 1] ? " is-muted" : ""}`} role="row" style={{ gridTemplateColumns: columns }}>
              <span className="n4-label">Ch {channel}</span>
              <N4Button small on={muted[channel - 1] === true}
                onClick={() => setParameter("muted", CHANNELS.map((c) => (c === channel ? !muted[c - 1] : muted[c - 1] === true)))}
                title="Mute this channel">M</N4Button>
              {voices.map((v) => {
                const on = (orchestration[position]?.[v] ?? []).includes(channel);
                return (
                  <button type="button" key={v} className={`n4-matrix__cell uvoice uvoice--${v + 1}${on ? " is-on" : ""}`} aria-pressed={on}
                    aria-label={`Voice ${v + 1} on channel ${channel}`}
                    onClick={(event) => { event.stopPropagation(); setParameter("orchestration", toggleChannel(orchestration, position, v, channel) as never); }}>
                    {on ? v + 1 : ""}
                  </button>
                );
              })}
              <input className="n4-input" aria-label={`Channel ${channel} program`}
                value={shownProgram(programs[soundPosition]?.[channel - 1] ?? null, numbering)} placeholder="–"
                onChange={(event) => setParameter("programs",
                  setProgram(programs, soundPosition, channel - 1, parseProgram(event.currentTarget.value, numbering)) as never)} />
            </div>
          ))}
        </div>
      </div>
    </N4Panel>
  );
}
