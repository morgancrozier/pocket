import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerToolActivityState } from "@/lib/webmcp/usePokerTools";

const idleActivity: PokerToolActivityState = {
  activeTool: null,
  receipts: [],
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof AgentSuggestionPanel>> = {},
) {
  return renderToStaticMarkup(
    <AgentSuggestionPanel
      suggestion={null}
      receipt={null}
      situation={INITIAL_SITUATION}
      supportState="available"
      activity={idleActivity}
      isSubmitting={false}
      onDismiss={vi.fn()}
      {...overrides}
    />,
  );
}

describe("AgentSuggestionPanel", () => {
  it("keeps the ready state compact and preserves the human-action boundary", () => {
    const html = renderPanel();

    expect(html).toContain("Ready for your agent");
    expect(html).toContain("recommend one legal action");
    expect(html).toContain("Recommendations never execute a poker action");
    expect(html).not.toContain("copilot-onboarding-steps");
  });

  it("does not claim readiness when WebMCP is unavailable", () => {
    const html = renderPanel({ supportState: "unavailable" });

    expect(html).toContain("WebMCP unavailable");
    expect(html).not.toContain("tools registered");
    expect(html).toContain("Awaiting a recommendation");
  });

  it("marks an older version-bound recommendation as stale", () => {
    const html = renderPanel({
      staleSuggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion - 1,
        action: "raise",
        amount: 64,
      },
    });

    expect(html).toContain("Recommendation expired");
    expect(html).toContain("Raise to 64");
    expect(html).toContain("The table changed after this advice");
    expect(html).not.toContain("Use Raise to 64");
  });

  it("shows a structured rejection without replacing current advice", () => {
    const html = renderPanel({
      suggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "call",
        confidence: 0.7,
      },
      activity: {
        activeTool: null,
        receipts: [
          {
            id: 1,
            tool: "suggest_action",
            status: "rejected",
            message: "Minimum total for raise is 64.",
          },
        ],
      },
    });

    expect(html).toContain("Recommendation");
    expect(html).not.toContain("Ready for your agent");
    expect(html).toContain("Latest suggestion was rejected");
    expect(html).toContain("Minimum total for raise is 64.");
  });
});

describe("AgentSuggestionPanel registration truthfulness", () => {
  it("states WebMCP readiness without claiming an agent connection", () => {
    const openHtml = renderPanel();
    expect(openHtml).toContain("WebMCP ready");
    expect(openHtml).toContain("Ask your browser agent to read this hand");
    expect(openHtml).not.toContain("Seat-safe connection");
    expect(openHtml).not.toContain("tools registered");

    const waitingHtml = renderPanel({
      situation: {
        ...INITIAL_SITUATION,
        isYourTurn: false,
        currentActorId: "alex",
        legalActions: [],
      },
    });
    expect(waitingHtml).toContain("WebMCP ready");
    expect(waitingHtml).toContain("can read this seat-safe table now");
    expect(waitingHtml).not.toContain("tools registered");
  });
});
