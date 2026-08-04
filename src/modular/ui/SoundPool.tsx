/**
 * The sound pool.
 *
 * A list of samples with a waveform, a preview button and a delete — and three
 * decisions that make it more than that.
 *
 * **The thumbnail is the identity.** File names are `bd_01_final_v3.wav`; a
 * waveform tells you at a glance which one is the kick and which one has the
 * long tail. So the waveform is the row's primary content and the name is its
 * caption, the same reasoning as the theme picker's swatches.
 *
 * **Missing is a first-class state, not an error.** A document stores which
 * samples a patch uses, never the audio, so reopening a project on another
 * machine shows the rows greyed with their waveforms intact. Dropping the files
 * back re-attaches them silently, because identity is the content hash.
 *
 * **It does nothing until audio is on.** Decoding needs a context, and a
 * context needs a gesture. Rather than pretend, the panel says so and offers
 * the one button that fixes it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetEntry } from "../audio/assets";
import { isSilent, peaksToPath } from "../audio/waveform";

const THUMBNAIL = { width: 132, height: 34 } as const;

export type SoundPoolProps = {
  entries: AssetEntry[];
  /** Null when audio has not been started; the panel offers to start it. */
  ready: boolean;
  playingAssetId: string | null;
  onStartAudio: () => void;
  onAddFiles: (files: File[]) => void;
  onPlay: (assetId: string) => void;
  onStop: () => void;
  onRemove: (assetId: string) => void;
  onClose: () => void;
};

function Waveform({ entry }: { entry: AssetEntry }) {
  const path = peaksToPath(entry.peaks, THUMBNAIL.width, THUMBNAIL.height);
  return (
    <svg
      className="mm-pool__wave"
      viewBox={`0 0 ${THUMBNAIL.width} ${THUMBNAIL.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${entry.name} waveform`}
    >
      <line x1="0" y1={THUMBNAIL.height / 2} x2={THUMBNAIL.width} y2={THUMBNAIL.height / 2} />
      {path ? <path d={path} /> : null}
    </svg>
  );
}

const seconds = (value: number): string =>
  value >= 10 ? `${value.toFixed(0)}s` : `${value.toFixed(2)}s`;

export function SoundPool({
  entries,
  ready,
  playingAssetId,
  onStartAudio,
  onAddFiles,
  onPlay,
  onStop,
  onRemove,
  onClose,
}: SoundPoolProps) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Counted rather than set as a flag: `dragleave` fires when the pointer
  // crosses onto a child element, so a boolean makes the highlight flicker
  // every time the cursor passes over a row.
  const dragDepth = useRef(0);

  const accept = useCallback((list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length > 0) onAddFiles(files);
  }, [onAddFiles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      className={`mm-pool${dragging ? " is-dropping" : ""}`}
      aria-label="Sound pool"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        accept(event.dataTransfer?.files ?? null);
      }}
    >
      <header className="mm-pool__header">
        <strong>Sound pool</strong>
        <span>{entries.length} sample</span>
        <button type="button" className="mm-pool__close" onClick={onClose} aria-label="Close sound pool">×</button>
      </header>

      {!ready ? (
        <div className="mm-pool__notice">
          <p>Decoding needs an audio context, and a context needs a click.</p>
          <button type="button" onClick={onStartAudio}>Start audio</button>
        </div>
      ) : null}

      <div className="mm-pool__list">
        {entries.length === 0 ? (
          <p className="mm-pool__empty">Drop audio files here.</p>
        ) : entries.map((entry) => {
          const playing = playingAssetId === entry.id;
          const missing = entry.status === "missing";
          return (
            <div
              key={entry.id}
              className={`mm-pool__item${missing ? " is-missing" : ""}${playing ? " is-playing" : ""}`}
              draggable={!missing}
              onDragStart={(event) => {
                // Stage E's players read this: dropping a row onto a player
                // assigns the sample by id, never by name.
                event.dataTransfer.setData("application/x-modular-asset", entry.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <button
                type="button"
                className="mm-pool__play"
                disabled={missing || !ready}
                aria-label={playing ? `Stop ${entry.name}` : `Play ${entry.name}`}
                onClick={() => (playing ? onStop() : onPlay(entry.id))}
              >{playing ? "■" : "▶"}</button>
              <Waveform entry={entry} />
              <div className="mm-pool__meta">
                <span className="mm-pool__name" title={entry.name}>{entry.name}</span>
                <span className="mm-pool__detail">
                  {missing
                    ? "missing — drop the file to restore"
                    : `${seconds(entry.durationSec)} · ${entry.channels === 1 ? "mono" : "stereo"}${isSilent(entry.peaks) ? " · silent" : ""}`}
                </span>
              </div>
              <button
                type="button"
                className="mm-pool__remove"
                aria-label={`Remove ${entry.name}`}
                onClick={() => onRemove(entry.id)}
              >×</button>
            </div>
          );
        })}
      </div>

      <footer className="mm-pool__footer">
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!ready}>
          Add files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(event) => {
            accept(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </footer>
    </aside>
  );
}
