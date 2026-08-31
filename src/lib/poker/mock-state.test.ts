import { describe, expect, it } from "vitest";
import {
  INITIAL_SITUATION,
  isMockFallbackRequested,
} from "./mock-state";

describe("mock fallback", () => {
  it("remains explicitly selectable and player-safe", () => {
    expect(isMockFallbackRequested("?mode=mock")).toBe(true);
    expect(isMockFallbackRequested("?mode=engine")).toBe(false);
    expect(INITIAL_SITUATION.isYourTurn).toBe(true);
    expect(INITIAL_SITUATION.yourCards).toHaveLength(2);

    const serialized = JSON.stringify(INITIAL_SITUATION);
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"holeCards"');
    expect(serialized).not.toContain('"burnCards"');
  });
});
