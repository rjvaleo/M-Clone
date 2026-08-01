// Miniature representations of Variable Positions.
//
// The manual is specific about what these are: "Each Variable has a miniature
// representation of each of its six Positions, so you have some idea of what
// the Variable Position will do. The miniature representation usually reflects
// the user interface design of the edit window. Each miniature representation
// contains four vertically arranged settings, one for each Voice."
//
// So these are not decorative swatches keyed to one number — each is a scaled
// drawing of that position's actual contents, laid out like its edit window,
// four rows deep. Reading a Position at a glance is the whole point.
//
// Everything is drawn 1-bit in a 40x28 box on integer coordinates. Shapes paint
// in `currentColor` so the Active Position can invert the whole cell.

import { useId } from "react";
import type { NoteOrderMix, VelocityRange } from "../engine/types";
import { type TimeMap, timeMapPolyline } from "../engine/timemap";
import type { PositionValue, PositionVarId } from "../engine/variables";

const W = 40;
const H = 28;
const ROWS = 4;
const ROW_H = H / ROWS; // 7px per Voice
/** Vertical centre of a Voice's row. */
const midY = (voice: number) => voice * ROW_H + ROW_H / 2;

/**
 * The dither pattern has to live inside each thumbnail's own <svg>, with its
 * own id — `currentColor` resolves against the element that owns the pattern,
 * so a single shared definition would freeze every dither at the first cell's
 * colour and stop the Active Position from inverting.
 */
function Box({ children }: { children: (dither: string) => React.ReactNode }) {
  const id = `umini-dither-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className="umini__art"
      viewBox={`0 0 ${W} ${H}`}
      // Stretch to the cell rather than letterbox: these are schematic
      // drawings, and filling the cell is what makes the four Voice rows read.
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={id} width={2} height={2} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" />
          <rect x={1} y={1} width={1} height={1} fill="currentColor" />
        </pattern>
      </defs>
      {children(`url(#${id})`)}
    </svg>
  );
}

/**
 * Note Density — the edit window's lines with a square on the end. Per the
 * manual: "the farther the line is to the right, the higher the percentage of
 * time the Voice will play."
 */
function DensityArt({ slot }: { slot: PositionValue[] }) {
  return (
    <Box>
      {() =>
        slot.map((value, voice) => {
          const y = midY(voice);
          const end = 2 + Math.round((Number(value) || 0) * (W - 8));
          return (
            <g key={voice} className={`uvoice uvoice--${voice + 1}`}>
              <rect x={2} y={y - 0.5} width={W - 4} height={1} opacity={0.35} />
              <rect x={2} y={y - 1} width={Math.max(1, end - 2)} height={2} />
              <rect x={end - 1} y={y - 2.5} width={4} height={5} />
            </g>
          );
        })
      }
    </Box>
  );
}

/** Velocity Range — the edit window's drawn band, from low velocity to high. */
function VelocityArt({ slot }: { slot: PositionValue[] }) {
  return (
    <Box>
      {(dither) =>
        slot.map((value, voice) => {
          const { low, high } = value as VelocityRange;
          const x1 = 2 + (low / 127) * (W - 4);
          const x2 = 2 + (high / 127) * (W - 4);
          const y = midY(voice);
          return (
            <g key={voice} className={`uvoice uvoice--${voice + 1}`}>
              <rect x={2} y={y - 0.5} width={W - 4} height={1} opacity={0.35} />
              <rect x={x1} y={y - 2.5} width={Math.max(2, x2 - x1)} height={5}
                fill={dither} />
            </g>
          );
        })
      }
    </Box>
  );
}

/**
 * Note Order — the edit window's three-region bar. Original is solid, Cyclic
 * Random is dithered, Utterly Random is left open, in that order.
 */
function NoteOrderArt({ slot }: { slot: PositionValue[] }) {
  return (
    <Box>
      {(dither) =>
        slot.map((value, voice) => {
          const mix = value as NoteOrderMix;
          const span = W - 4;
          const a = (mix.original / 100) * span;
          const b = (mix.cyclic / 100) * span;
          const y = voice * ROW_H + 1;
          const h = ROW_H - 2;
          return (
            <g key={voice} className={`uvoice uvoice--${voice + 1}`}>
              <rect x={2} y={y} width={span} height={h} fill="none"
                stroke="currentColor" strokeWidth={0.5} opacity={0.5} />
              {a > 0 && <rect x={2} y={y} width={a} height={h} />}
              {b > 0 && <rect x={2 + a} y={y} width={b} height={h} fill={dither} />}
            </g>
          );
        })
      }
    </Box>
  );
}

/**
 * Transposition — a block per Voice placed left of centre for a downward
 * transposition and right for an upward one, so an untransposed Position reads
 * as a single vertical column.
 */
function TranspositionArt({ slot }: { slot: PositionValue[] }) {
  return (
    <Box>
      {() => (
        <>
          <rect x={W / 2 - 0.5} y={1} width={1} height={H - 2} opacity={0.35} />
          {slot.map((value, voice) => {
            const semitones = Math.max(-24, Math.min(24, Number(value) || 0));
            const x = W / 2 + (semitones / 24) * (W / 2 - 4);
            return (
              <rect key={voice} className={`uvoice uvoice--${voice + 1}`}
                x={x - 3} y={midY(voice) - 2.5} width={6} height={5} />
            );
          })}
        </>
      )}
    </Box>
  );
}

/**
 * Time Distortion — four little graphs side by side, one per Voice, each
 * drawing that Voice's Time Map. This is the one row the manual's "four
 * vertically arranged settings" rule doesn't fit: a time map is a graph, so
 * the miniature is four small graphs. Four neutral maps read as four parallel
 * slashes, which is exactly what the original shows.
 */
function TimeDistortArt({ slot }: { slot: PositionValue[] }) {
  const cellW = W / ROWS;
  return (
    <Box>
      {() =>
        slot.map((value, voice) => {
          const map = value as TimeMap;
          const left = voice * cellW + 1.5;
          const span = cellW - 3;
          const top = 2.5;
          const height = H - 5;
          // Real Time runs left to right, Clock Time bottom to top.
          const d = timeMapPolyline(map)
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"} ${left + p.x * span} ${top + (1 - p.y) * height}`,
            )
            .join(" ");
          return (
            <path key={voice} className={`uvoice uvoice--${voice + 1}`}
              d={d} fill="none" stroke="currentColor"
              strokeWidth={2} shapeRendering="geometricPrecision" />
          );
        })
      }
    </Box>
  );
}

/** Orchestration — the edit window's 16-channel grid, four Voices deep. */
function OrchestrationArt({ slot }: { slot: PositionValue[] }) {
  return (
    <Box>
      {() =>
        slot.map((value, voice) => {
          const channels = value as number[];
          return (
            <g key={voice} className={`uvoice uvoice--${voice + 1}`}>
              {Array.from({ length: 16 }, (_, i) => (
                <rect key={i} x={2 + i * 2.25} y={voice * ROW_H + 1.5}
                  width={1.75} height={ROW_H - 3}
                  opacity={channels.includes(i + 1) ? 1 : 0.2} />
              ))}
            </g>
          );
        })
      }
    </Box>
  );
}

export function VarThumb({ id, slot }: { id: PositionVarId; slot: PositionValue[] }) {
  switch (id) {
    case "density":
      return <DensityArt slot={slot} />;
    case "velocityRange":
      return <VelocityArt slot={slot} />;
    case "noteOrderMix":
      return <NoteOrderArt slot={slot} />;
    case "transposition":
      return <TranspositionArt slot={slot} />;
    case "timeDistort":
      return <TimeDistortArt slot={slot} />;
    case "outputChannels":
      return <OrchestrationArt slot={slot} />;
  }
}
