import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerToolActivityState } from "@/lib/webmcp/usePokerTools";

const idleActivity: PokerToolActivityState = {
  activeTool: null,
  latest: null,
  recent: [],
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

    expect(html).toContain("Private copilot");
    expect(html).toContain("Ready");
    expect(html).toContain(
      "Ask your browser agent for advice. It will appear here.",
    );
    expect(html).toContain("Recommendations never execute a poker action");
    expect(html).not.toContain("copilot-recommendation is-awaiting");
    expect(html).not.toContain("copilot-onboarding-steps");
  });

  it("does not claim readiness when WebMCP is unavailable", () => {
    const html = renderPanel({ supportState: "unavailable" });

    expect(html).toContain("Unavailable");
    expect(html).not.toContain("tools registered");
    expect(html).toContain("cannot expose Pocket’s tools");
  });

  it("prominently presents a staged recommendation and its concise rationale", () => {
    const html = renderPanel({
      suggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "raise",
        amount: 64,
        rationale: "Top pair can value-raise within the legal range.",
        confidence: 0.74,
        stagedAt: 1_777_777_777_777,
      },
    });

    expect(html).toContain("Agent recommends");
    expect(html).toContain("Raise to 64");
    expect(html).toContain("Top pair can value-raise within the legal range.");
    expect(html).toContain("Suggestion only — no action taken.");
    expect(html).not.toContain("74% confidence");
    expect(html).not.toContain("suggestion-confidence");
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
        recent: [],
      },
    });

    expect(html).toContain("Agent recommends");
    expect(html).not.toContain("Ready for your agent");
    expect(html).toContain("Latest recommendation was rejected");
    expect(html).toContain("Minimum total for raise is 64.");
  });

  it("leaves completed read activity to the dedicated WebMCP surface", () => {
    const html = renderPanel({
      activity: {
        activeTool: null,
        latest: {
          tool: "get_current_situation",
          status: "completed",
        },
        recent: [],
      },
    });

    expect(html).not.toContain("Hand read by your agent");
    expect(html).not.toContain("copilot-activity");
  });

  it("does not repeat a completed recommendation activity below current advice", () => {
    const html = renderPanel({
      suggestion: {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "call",
        stagedAt: 1_777_777_777_777,
      },
      activity: {
        activeTool: null,
        latest: {
          tool: "stage_recommendation",
          status: "completed",
        },
        recent: [],
      },
    });

    expect(html).toContain("Agent recommends");
    expect(html).not.toContain("Recommendation staged");
    expect(html).not.toContain("copilot-activity");
  });
});

describe("AgentSuggestionPanel registration truthfulness", () => {
  it("states WebMCP readiness without claiming an agent connection", () => {
    const openHtml = renderPanel();
    expect(openHtml).toContain("Ready");
    expect(openHtml).toContain("Ask your browser agent for advice");
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
    expect(waitingHtml).toContain("Ready");
    expect(waitingHtml).toContain("can read this seat-safe table");
    expect(waitingHtml).not.toContain("tools registered");
  });
});
