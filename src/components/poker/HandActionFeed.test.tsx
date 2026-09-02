import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HandActionFeed } from "@/components/poker/HandActionFeed";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerSituation } from "@/types/poker";

describe("HandActionFeed", () => {
  const completedSituation: PokerSituation = {
    ...INITIAL_SITUATION,
    street: "showdown" as const,
    isYourTurn: false,
    currentActorId: null,
    board: ["Ah", "9s", "4c", "Jd", "2h"],
    recentActions: [
      ...INITIAL_SITUATION.recentActions,
      {
        sequence: 6,
        street: "turn" as const,
        playerId: "alex",
        playerName: "Alex",
        action: "check" as const,
      },
      {
        sequence: 7,
        street: "river" as const,
        playerId: "hero",
        playerName: "Morgan",
        action: "call" as const,
        amount: 1,
      },
    ],
    handResult: {
      reason: "showdown" as const,
      winners: [{ playerId: "hero", playerName: "Morgan", amount: 1 }],
    },
  };

  it("keeps previous streets compact and records awards", () => {
    const html = renderToStaticMarkup(
      <HandActionFeed situation={completedSituation} />,
    );

    expect(html).toContain("hand-feed-amount\"> 1");
    expect(html).toContain("River");
    expect(html).toContain("1 action");
    expect(html).toContain("Preflop");
    expect(html).toContain("3 actions");
    expect(html).toContain("Showdown");
    expect(html).toContain("You win");
  });

  it("shows the current street action and board card", () => {
    const html = renderToStaticMarkup(
      <HandActionFeed
        situation={{
          ...completedSituation,
          street: "river",
          handResult: null,
        }}
      />,
    );

    expect(html).toContain("River cards");
    expect(html).toContain("2♥");
    expect(html).toContain("You call");
    expect(html).toContain("hand-feed-amount\"> 1");
  });
});
