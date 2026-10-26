import { describe, expect, it } from "vitest";
import { readoutText } from "./readout";

describe("A readout the original's way", () => {
  it("prints a bare number at two places, as SoundHack's dials do", () => {
    expect(readoutText(-20, { decimals: 2 })).toBe("-20.00");
    expect(readoutText(0.6, { decimals: 2 })).toBe("0.60");
  });

  it("prints a whole number with no places", () => {
    expect(readoutText(64, { decimals: 0 })).toBe("64");
  });

  it("scales a 0–1 control to the original's 0–100", () => {
    expect(readoutText(0.5, { decimals: 1, scale: 100 })).toBe("50.0");
  });

  it("shows ++compand's slope as a ratio: N:1 below 1, 1:N above", () => {
    expect(readoutText(0.5, { ratio: true })).toBe("2.0:1");
    expect(readoutText(1, { ratio: true })).toBe("1.0:1");
    expect(readoutText(2.5, { ratio: true })).toBe("1:2.5");
  });

  it("prints four figures and up whole, so they fit on a dial", () => {
    expect(readoutText(20000, { decimals: 2 })).toBe("20000");
    expect(readoutText(948.7, { decimals: 1 })).toBe("948.7");
  });

  it("never prints minus zero", () => {
    expect(readoutText(-0.0001, { decimals: 2 })).toBe("0.00");
  });
});
