import { describe, expect, it } from "vitest";
import { clampBetTotal, getBetSizingPresets } from "./bet-sizing";

describe("bet sizing", () => {
  it("calculates opening-bet presets as fractions of the current pot", () => {
    expect(
      getBetSizingPresets({
        pot: 15,
        toCall: 0,
        committedThisStreet: 0,
        minTotal: 4,
        maxTotal: 40,
      }),
    ).toEqual({ min: 4, halfPot: 8, pot: 15, allIn: 40 });
  });

  it("calculates raise-to presets after matching the current wager", () => {
    expect(
      getBetSizingPresets({
        pot: 12,
        toCall: 4,
        committedThisStreet: 0,
        minTotal: 8,
        maxTotal: 32,
      }),
    ).toEqual({ min: 8, halfPot: 12, pot: 20, allIn: 32 });
  });

  it("clamps every preset and typed total to authoritative legal bounds", () => {
    expect(
      getBetSizingPresets({
        pot: 2,
        toCall: 1,
        committedThisStreet: 1,
        minTotal: 8,
        maxTotal: 8,
      }),
    ).toEqual({ min: 8, halfPot: 8, pot: 8, allIn: 8 });
    expect(clampBetTotal(1, 8, 32)).toBe(8);
    expect(clampBetTotal(99, 8, 32)).toBe(32);
    expect(clampBetTotal(16.4, 8, 32)).toBe(16);
  });
});
