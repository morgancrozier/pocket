import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HumanActionDock } from "@/components/poker/HumanActionDock";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";

const raiseRecommendation: AgentSuggestion = {
  handNumber: INITIAL_SITUATION.handNumber,
  stateVersion: INITIAL_SITUATION.stateVersion,
  action: "raise",
  amount: 80,
  stagedAt: 1_777_777_777_777,
};

function renderDock(
  betDraft: string,
  recommendation: AgentSuggestion | null,
  situation: PokerSituation = INITIAL_SITUATION,
) {
  return renderToStaticMarkup(
    <HumanActionDock
      situation={situation}
      turnTitle="Your turn"
      isSubmitting={false}
      betDraft={betDraft}
      betInputId="test-bet-amount"
      recommendation={recommendation}
      onBetDraftChange={vi.fn()}
      onCommit={vi.fn()}
      onSubmitSizedAction={vi.fn()}
    />,
  );
}

describe("HumanActionDock recommendation integration", () => {
  it("marks the matching raise total as the agent pick", () => {
    const html = renderDock("80", raiseRecommendation);

    expect(html).toContain('value="80"');
    expect(html).toContain('data-recommended="true"');
    expect(html).toContain("Agent pick");
    expect(html).toContain("Raise to 80");
  });

  it("removes the agent-pick marker when the human changes the raise total", () => {
    const html = renderDock("81", raiseRecommendation);

    expect(html).toContain("Raise to 81");
    expect(html).not.toContain('data-recommended="true"');
    expect(html).not.toContain("Agent pick");
  });

  it.each([
    ["fold", "Fold"],
    ["call", "Call 32"],
    ["check", "Check"],
  ] as const)(
    "marks the existing %s action without adding another control",
    (action, label) => {
      const situation =
        action === "check"
          ? {
              ...INITIAL_SITUATION,
              currentBet: 0,
              toCall: 0,
              legalActions: [
                { type: "fold" as const },
                { type: "check" as const },
                { type: "bet" as const, minTotal: 2, maxTotal: 184 },
              ],
            }
          : INITIAL_SITUATION;
      const html = renderDock(
        action === "check" ? "2" : "64",
        {
          ...raiseRecommendation,
          action,
          amount: undefined,
        },
        situation,
      );

      expect(html.match(/class="action-button /g)).toHaveLength(3);
      expect(html.match(/data-recommended="true"/g)).toHaveLength(1);
      expect(html).toContain(label);
    },
  );
});
