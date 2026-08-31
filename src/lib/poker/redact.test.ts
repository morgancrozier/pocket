import { describe, expect, it } from "vitest";
import type { RawGameState } from "@/types/poker";
import { projectGameForPlayer } from "./redact";

const raw: RawGameState = {
  gameId: "game-1",
  handNumber: 2,
  stateVersion: 7,
  street: "flop",
  board: ["2c", "7d", "Jh"],
  deck: ["As", "Ad", "Ks", "Kd"],
  players: [
    {
      id: "morgan",
      displayName: "Morgan",
      seat: 0,
      stack: 100,
      status: "active",
      committedThisStreet: 4,
      isBot: false,
      hasAgent: true,
      holeCards: ["As", "Ad"],
      cardsRevealed: false,
    },
    {
      id: "alex",
      displayName: "Alex",
      seat: 1,
      stack: 100,
      status: "active",
      committedThisStreet: 4,
      isBot: false,
      hasAgent: true,
      holeCards: ["Ks", "Kd"],
      cardsRevealed: false,
    },
  ],
};

describe("projectGameForPlayer", () => {
  it("includes the viewer's cards and removes every other hidden hand and the deck", () => {
    const projected = projectGameForPlayer(raw, "morgan");
    const serialized = JSON.stringify(projected);

    expect(projected.players[0]?.holeCards).toEqual(["As", "Ad"]);
    expect(projected.players[1]?.holeCards).toBeUndefined();
    expect(serialized).not.toContain("Ks");
    expect(serialized).not.toContain("Kd");
    expect(serialized).not.toContain('"deck"');
  });

  it("shows cards that were legitimately revealed at showdown", () => {
    const showdownState: RawGameState = {
      ...raw,
      street: "showdown",
      players: raw.players.map((player) => ({
        ...player,
        cardsRevealed: true,
      })),
    };

    const projected = projectGameForPlayer(showdownState, "morgan");

    expect(projected.players[1]?.holeCards).toEqual(["Ks", "Kd"]);
  });

  it("rejects a viewer who is not seated", () => {
    expect(() => projectGameForPlayer(raw, "intruder")).toThrow(
      "Viewer is not seated",
    );
  });
});
