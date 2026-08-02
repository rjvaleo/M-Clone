import type { CSSProperties } from "react";

export type ClassicCyclicSideStyle = CSSProperties & {
  "--cyclic-value-row-height": string;
  "--cyclic-value-box-width": string;
  "--cyclic-position-row-height": string;
  "--cyclic-selector-outer": string;
  "--cyclic-selector-inner": string;
};

/** Geometry for the fixed-height Classic side panel at the 100% baseline. */
export function classicCyclicSideLayout(): ClassicCyclicSideStyle {
  return {
    gridTemplateRows: "48px repeat(3, 93px)",
    "--cyclic-value-row-height": "18px",
    "--cyclic-value-box-width": "34px",
    "--cyclic-position-row-height": "10px",
    "--cyclic-selector-outer": "polygon(0 0, 92px 0, 59px 26px, 0 26px)",
    "--cyclic-selector-inner": "polygon(1px 1px, 89px 1px, 58px 25px, 1px 25px)",
  };
}
