import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PokerTableSurface } from "@/components/poker/PokerTableSurface";
import { createDecisionPresentation } from "@/lib/poker/decision-presentation";
import { createHandResultPresentation } from "@/lib/poker/hand-result-presentation";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerSituation } from "@/types/poker";

describe("PokerTableSurface result ceremony", () => {
  it("keeps the board and revealed cards visible while marking the winner", () => {
    const situation: PokerSituation = {
      ...INITIAL_SITUATION,
      street: "showdown",
      isYourTurn: false,
      currentActorId: null,
      board: ["Ah", "9s", "4c", "Jd", "2h"],
      legalActions: [],
      players: INITIAL_SITUATION.players.map((player) =>
        player.id === "alex"
          ? { ...player, revealedCards: ["Kh", "Kd"] }
          : player,
      ),
      handResult: {
        reason: "showdown",
        winners: [{ playerId: "alex", playerName: "Alex", amount: 68 }],
      },
    };
    const result = createHandResultPresentation(situation);
    const html = renderToStaticMarkup(
      <PokerTableSurface
        situation={situation}
        presentation={createDecisionPresentation(situation)}
        turnTitle="Hand complete"
        result={result}
      />,
    );

    expect(html).toContain("Alex wins 68 chips");
    expect(html).toContain('data-winner="true"');
    expect(html).toContain("+68 chips");
    expect(html).toContain('aria-label="King of hearts"');
    expect(html).toContain('aria-label="Ace of hearts"');
  });

  it("does not reveal folded opponents when the hand ends without showdown", () => {
    const situation: PokerSituation = {
      ...INITIAL_SITUATION,
      isYourTurn: false,
      currentActorId: null,
      legalActions: [],
      handResult: {
        reason: "fold",
        winners: [{ playerId: "hero", playerName: "Morgan", amount: 68 }],
      },
    };
    const result = createHandResultPresentation(situation);
    const html = renderToStaticMarkup(
      <PokerTableSurface
        situation={situation}
        presentation={createDecisionPresentation(situation)}
        turnTitle="Hand complete"
        result={result}
      />,
    );

    expect(html).toContain("Won without showdown");
    expect(html).not.toContain("King of hearts");
    expect(html).not.toContain("King of diamonds");
  });
});
