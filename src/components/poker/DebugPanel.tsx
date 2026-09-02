"use client";

import { useState } from "react";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";
import type { WebMCPSupportState } from "@/lib/webmcp/usePokerTools";

interface DebugPanelProps {
  supportState: WebMCPSupportState;
  onFallbackSuggestion: (suggestion: AgentSuggestion) => void;
  situation: PokerSituation;
}

function supportsToolInspection(): boolean {
  return (
    typeof document !== "undefined" &&
    "modelContext" in document &&
    Boolean(document.modelContext)
  );
}

export function DebugPanel({
  supportState,
  onFallbackSuggestion,
  situation,
}: DebugPanelProps) {
  const [output, setOutput] = useState(
    "Use these controls to inspect the same player-safe state shown by the table.",
  );

  function currentLegalSuggestion() {
    const legal =
      situation.legalActions.find((action) => action.type === "raise") ??
      situation.legalActions.find((action) => action.type === "bet") ??
      situation.legalActions.find((action) => action.type === "call") ??
      situation.legalActions.find((action) => action.type === "check") ??
      situation.legalActions.find((action) => action.type === "fold");

    if (!legal || !situation.isYourTurn) return null;
    const isSizedAction = legal.type === "bet" || legal.type === "raise";
    return {
      action: legal.type,
      ...(isSizedAction && typeof legal.minTotal === "number"
        ? { amount: legal.minTotal }
        : {}),
      stateVersion: situation.stateVersion,
      confidence: 0.74,
    };
  }

  async function executeTool(name: string, input: Record<string, unknown> = {}) {
    if (!supportsToolInspection()) {
      setOutput(
        "document.modelContext is unavailable in this browser. The mock fallback can still inject a recommendation so you can build the UI.",
      );
      return;
    }

    try {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === name);

      if (!tool) {
        setOutput(`Tool ${name} is not registered in the current page state.`);
        return;
      }

      let result: string;

      try {
        result = await document.modelContext.executeTool(tool, input);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Failed to parse input arguments")
        ) {
          throw error;
        }

        // Some experimental browser builds require an object at the API
        // boundary but still parse its string representation internally.
        const compatibilityInput = Object(
          JSON.stringify(input),
        ) as Record<string, unknown>;
        result = await document.modelContext.executeTool(
          tool,
          compatibilityInput,
        );
      }

      setOutput(result);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Tool execution failed.");
    }
  }

  function injectFallback() {
    const legal = currentLegalSuggestion();

    if (!legal) {
      setOutput("There is no current human action to recommend.");
      return;
    }

    onFallbackSuggestion({
      handNumber: situation.handNumber,
      stateVersion: situation.stateVersion,
      action: legal.action,
      amount: legal.amount,
      stagedAt: Date.now(),
    });
    setOutput(
      "A legal local test recommendation was injected into React state. It did not come from an agent, and no game action was sent.",
    );
  }

  function executeSuggestionTool() {
    const suggestion = currentLegalSuggestion();
    if (!suggestion) {
      setOutput("There is no current human action to recommend.");
      return;
    }
    void executeTool("stage_recommendation", suggestion);
  }

  return (
    <section className="debug-card">
      <details>
        <summary>Development spike controls</summary>
        <div className="debug-content">
          <p className="debug-copy">
            WebMCP status: <strong>{supportState}</strong>. The suggestion tool only
            exists while it is your turn.
          </p>
          <div className="debug-actions">
            <button
              className="debug-button"
              onClick={() => executeTool("get_current_situation")}
            >
              Call current situation
            </button>
            <button
              className="debug-button"
              onClick={() => executeTool("get_hand_history")}
            >
              Call hand history
            </button>
            <button
              className="debug-button"
              onClick={executeSuggestionTool}
            >
              Call stage recommendation
            </button>
            <button className="debug-button" onClick={injectFallback}>
              Inject local suggestion
            </button>
          </div>
          <pre className="debug-output">{output}</pre>
        </div>
      </details>
    </section>
  );
}
