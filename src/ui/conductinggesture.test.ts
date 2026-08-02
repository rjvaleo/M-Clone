import { describe, expect, it } from "vitest";
import { conductingPullDirection } from "./conductinggesture";

describe("conducting pull gesture", () => {
  it("stays hidden until the pointer leaves the conducting arrow", () => {
    expect(conductingPullDirection(0, 0, 7, 5)).toBeNull();
    expect(conductingPullDirection(0, 0, 11, 0)).toBeNull();
  });

  it("opens in the dominant pull direction", () => {
    expect(conductingPullDirection(0, 0, 18, 2)).toBe("right");
    expect(conductingPullDirection(20, 10, 1, 8)).toBe("left");
    expect(conductingPullDirection(8, 20, 10, 1)).toBe("up");
    expect(conductingPullDirection(8, 2, 7, 19)).toBe("down");
  });
});
