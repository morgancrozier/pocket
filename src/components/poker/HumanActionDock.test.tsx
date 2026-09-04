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
  notice?: string,
) {
  return renderToStaticMarkup(
    <HumanActionDock
      situation={situation}
      turnTitle="Your turn"
      isSubmitting={false}
      notice={notice}
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
  it("keeps the decision heading focused on live betting totals", () => {
    const html = renderDock("64", null);

    expect(html).toContain("Pot");
    expect(html).toContain("To call");
    expect(html).not.toContain("decision-latest");
  });

  it("hides the sizing editor until the player chooses raise", () => {
    const html = renderDock("64", null);

    expect(html).toContain("Raise to…");
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("Min 64 · Max 184");
  });

  it("does not repeat a notice that describes the latest public action", () => {
    const html = renderDock("64", null, INITIAL_SITUATION, "Alex raises to · 44.");

    expect(html).toContain(
      'class="decision-notice" aria-live="polite" aria-atomic="true"></p>',
    );
  });

  it("marks the matching raise choice as the agent pick", () => {
    const html = renderDock("80", raiseRecommendation);

    expect(html).toContain('data-recommended="true"');
    expect(html).toContain("Agent pick");
    expect(html).toContain("Raise to…");
  });

  it("removes the agent-pick marker when the human changes the raise total", () => {
    const html = renderDock("81", raiseRecommendation);

    expect(html).toContain("Raise to…");
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

  it("renders a visual next-hand countdown with the explicit deal action", () => {
    const html = renderToStaticMarkup(
      <HumanActionDock
        situation={{
          ...INITIAL_SITUATION,
          isYourTurn: false,
          currentActorId: null,
          legalActions: [],
          handResult: {
            reason: "showdown",
            winners: [
              { playerId: "hero", playerName: "Morgan", amount: 68 },
            ],
          },
        }}
        turnTitle="Hand complete"
        isSubmitting={false}
        betDraft=""
        betInputId="result-bet-amount"
        terminalAction={{
          label: "Deal next hand",
          status: "Next hand in 7s",
          progress: 1,
          onClick: vi.fn(),
        }}
        onBetDraftChange={vi.fn()}
        onCommit={vi.fn()}
        onSubmitSizedAction={vi.fn()}
      />,
    );

    expect(html).toContain("Next hand in 7s");
    expect(html).toContain("Deal next hand");
    expect(html).toContain('class="terminal-progress" aria-hidden="true"');
  });
});
