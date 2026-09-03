import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebMCPActivity } from "@/components/poker/WebMCPActivity";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";

describe("WebMCPActivity", () => {
  it("renders only recorded tool events with their authoritative context", () => {
    const html = renderToStaticMarkup(
      <WebMCPActivity
        situation={INITIAL_SITUATION}
        activity={{
          activeTool: null,
          latest: null,
          recent: [
            {
              tool: "get_current_situation",
              status: "completed",
              handNumber: INITIAL_SITUATION.handNumber,
              stateVersion: INITIAL_SITUATION.stateVersion,
              street: INITIAL_SITUATION.street,
            },
            {
              tool: "stage_recommendation",
              status: "completed",
              handNumber: INITIAL_SITUATION.handNumber,
              stateVersion: INITIAL_SITUATION.stateVersion,
              street: INITIAL_SITUATION.street,
              recommendation: { action: "call", amount: 24 },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("WebMCP activity");
    expect(html).toContain("get_current_situation");
    expect(html).toContain(`state v${INITIAL_SITUATION.stateVersion}`);
    expect(html).toContain("seat-safe");
    expect(html).toContain("stage_recommendation");
    expect(html).toContain("Call 24");
    expect(html).not.toContain("Player action");
  });

  it("adds the human-confirmed action only when a real receipt exists", () => {
    const html = renderToStaticMarkup(
      <WebMCPActivity
        situation={INITIAL_SITUATION}
        activity={{ activeTool: null, latest: null, recent: [] }}
        receipt={{
          gameId: INITIAL_SITUATION.gameId,
          handNumber: INITIAL_SITUATION.handNumber,
          sourceStateVersion: INITIAL_SITUATION.stateVersion,
          recommendation: { action: "call" },
          humanChoice: { action: "raise", amount: 64 },
          outcome: "overridden",
        }}
      />,
    );

    expect(html).toContain("Player action");
    expect(html).toContain("Raise to 64 · human confirmed");
  });

  it("does not fabricate an activity row for an idle hand", () => {
    const html = renderToStaticMarkup(
      <WebMCPActivity
        situation={INITIAL_SITUATION}
        activity={{ activeTool: null, latest: null, recent: [] }}
      />,
    );

    expect(html).toContain("No WebMCP calls in this hand yet.");
    expect(html).not.toContain("get_current_situation");
  });
});
