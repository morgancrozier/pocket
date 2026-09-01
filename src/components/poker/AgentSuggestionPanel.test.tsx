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
      onUse={vi.fn()}
      onDismiss={vi.fn()}
      {...overrides}
    />,
  );
}

describe("AgentSuggestionPanel", () => {
  it("does not claim readiness when WebMCP is unavailable", () => {
    const html = renderPanel({ supportState: "unavailable" });

    expect(html).toContain("WebMCP unavailable");
    expect(html).not.toContain("Seat-safe connection");
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

    expect(html).toContain("Your copilot suggests");
    expect(html).toContain("Latest suggestion was rejected");
    expect(html).toContain("Minimum total for raise is 64.");
  });
});
