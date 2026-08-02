import { describe, expect, it } from "vitest";
import { decodeInputControl, inputControlCode, whiteKeyValue } from "./inputcontrol";

describe("Appendix B Input Control map", () => {
  it("numbers consecutive white keys from C1 through the printed value 26", () => {
    expect(whiteKeyValue(36)).toBe(0);
    expect(whiteKeyValue(60)).toBe(14);
    expect(whiteKeyValue(84)).toBe(28);
    expect(whiteKeyValue(37)).toBeNull();
  });

  it("maps the documented one-step performance keys", () => {
    expect(decodeInputControl(60)).toEqual({ type: "start" });
    expect(decodeInputControl(59)).toEqual({ type: "stop" });
    expect(decodeInputControl(65)).toEqual({ type: "sync" });
    expect(decodeInputControl(50)).toEqual({ type: "step-voice", voice: 0 });
    expect(decodeInputControl(77)).toEqual({ type: "stop-slideshow" });
  });

  it("maps black keys to their two-step command codes", () => {
    expect(inputControlCode(37)).toBe("snapshot");
    expect(inputControlCode(49)).toBe("pattern-group");
    expect(inputControlCode(58)).toBe("transposition");
    expect(inputControlCode(75)).toBe("play-slideshow");
  });

  it("covers every printed code key and one-step key plus out-of-range input", () => {
    const codes = [37,39,42,44,46,49,51,54,56,58,61,63,66,68,70,73,75,78];
    expect(codes.every((pitch) => inputControlCode(pitch) !== null)).toBe(true);
    expect(inputControlCode(60)).toBeNull();
    const actions = [36,38,40,41,43,45,47,48,50,52,53,55,57,59,60,62,64,
      65,67,69,71,74,76,77,79,80,81,83,84];
    expect(actions.every((pitch) => decodeInputControl(pitch) !== null)).toBe(true);
    expect(decodeInputControl(35)).toBeNull();
    expect(whiteKeyValue(35)).toBeNull();
  });
});
