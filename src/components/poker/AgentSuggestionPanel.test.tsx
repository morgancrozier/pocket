import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerToolActivityState } from "@/lib/webmcp/usePokerTools";

const idleActivity: PokerToolActivityState = {
  activeTool: null,
  latest: null,
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
    expect(html).toContain("Ask your agent: What should I do?");
    expect(html).toContain("Recommendations never execute a poker action");
    expect(html).not.toContain("copilot-onboarding-steps");
  });

  it("does not claim readiness when WebMCP is unavailable", () => {
    const html = renderPanel({ supportState: "unavailable" });

    expect(html).toContain("WebMCP unavailable");
    expect(html).not.toContain("tools registered");
    expect(html).toContain("Agent connection unavailable");
  });

  it("prominently presents a staged recommendation and its concise rationale", () => {
    const html = renderPanel({
      suggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "raise",
        amount: 64,
        rationale: "Top pair can value-raise within the legal range.",
        stagedAt: 1_777_777_777_777,
      },
    });

    expect(html).toContain("Agent recommends");
    expect(html).toContain("Raise to 64");
    expect(html).toContain("Top pair can value-raise within the legal range.");
    expect(html).toContain("Suggestion only — no action taken.");
  });

  it("shows a structured rejection without replacing current advice", () => {
    const html = renderPanel({
      suggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "call",
        confidence: 0.7,
        stagedAt: 1_777_777_777_777,
      },
      activity: {
        activeTool: null,
        latest: {
          tool: "stage_recommendation",
          status: "rejected",
          message: "Minimum total for raise is 64.",
        },
      },
    });

    expect(html).toContain("Agent recommends");
    expect(html).not.toContain("Ready for your agent");
    expect(html).toContain("Latest recommendation was rejected");
    expect(html).toContain("Minimum total for raise is 64.");
  });

  it("shows one read status instead of accumulating a checklist", () => {
    const html = renderPanel({
      activity: {
        activeTool: null,
        latest: {
          tool: "get_current_situation",
          status: "completed",
        },
      },
    });

    expect(html).toContain("Hand read by your agent");
    expect(html).not.toContain("Recent WebMCP activity");
    expect(html.match(/copilot-activity/g)).toHaveLength(1);
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
