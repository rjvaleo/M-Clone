// Light or dark for M's windows. Inside idMLab the canvas theme decides, so
// M never paints a light interface onto a dark canvas (or the reverse), and
// M's own Light/Dark switch is hidden in favour of the canvas's picker.

export type MTheme = "light" | "dark";

export function mTheme(host: MTheme | undefined, own: MTheme): { theme: MTheme; ownSwitch: boolean } {
  return host ? { theme: host, ownSwitch: false } : { theme: own, ownSwitch: true };
}
