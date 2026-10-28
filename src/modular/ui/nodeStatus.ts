/**
 * Reading a node's status line well enough to light an indicator.
 *
 * `runtime.nodeStatus()` returns human strings — "Playing · 3.2", "Step 4",
 * "0 accepted · 0 rejected", "Idle" — because that is what a face shows. A
 * kit's LED and meter need something narrower than a sentence, so this is the
 * one place that turns the sentence into a boolean and a level.
 *
 * Deliberately conservative: anything it cannot read counts as idle and
 * level zero. An indicator that is wrong is worse than one that is dark,
 * because a lit LED is a claim that the module is doing something.
 */

/** The strings a module uses to say it is doing nothing. Compared
 * case-insensitively, after trimming. */
export const IDLE_STATUSES: readonly string[] = [
  "idle",
  "stopped",
  "off",
  "none",
  "—",
  "-",
];

/** The first number anywhere in the text, or `undefined`. */
function leadingCount(text: string): number | undefined {
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Whether a status line describes a module that is currently doing something. */
export function isLiveStatus(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (IDLE_STATUSES.includes(trimmed.toLowerCase())) return false;
  // A status that is entirely zeroes is idle stated at length: "0 accepted ·
  // 0 rejected" is a module that has handled nothing.
  const count = leadingCount(trimmed);
  if (count !== undefined && !/[1-9]/.test(trimmed)) return false;
  return true;
}

/** A status line's leading count as a `0..1` fraction of `maximum`. */
export function statusLevel(text: string | undefined, maximum: number): number {
  if (!text || maximum <= 0) return 0;
  const count = leadingCount(text);
  if (count === undefined) return 0;
  return Math.min(1, Math.max(0, count / maximum));
}
