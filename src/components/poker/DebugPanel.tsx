"use client";

import { useState } from "react";
import type { AgentSuggestion } from "@/types/poker";
import type { WebMCPSupportState } from "@/lib/webmcp/usePokerTools";

interface DebugPanelProps {
  supportState: WebMCPSupportState;
  onFallbackSuggestion: (suggestion: AgentSuggestion) => void;
  handNumber: number;
  stateVersion: number;
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
  handNumber,
  stateVersion,
}: DebugPanelProps) {
  const [output, setOutput] = useState(
    "Use these controls to prove the WebMCP interaction before integrating the real poker engine.",
  );

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

      const result = await document.modelContext.executeTool(tool, input);
      setOutput(result);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Tool execution failed.");
    }
  }

  function injectFallback() {
    onFallbackSuggestion({
      handNumber,
      stateVersion,
      action: "raise",
      amount: 64,
      confidence: 0.74,
    });
    setOutput(
      "Fallback recommendation injected directly into React state. This is only for UI development when WebMCP is unavailable.",
    );
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
              onClick={() =>
                executeTool("suggest_action", {
                  action: "raise",
                  amount: 64,
                  confidence: 0.74,
                })
              }
            >
              Call suggest action
            </button>
            <button className="debug-button" onClick={injectFallback}>
              Inject mock suggestion
            </button>
          </div>
          <pre className="debug-output">{output}</pre>
        </div>
      </details>
    </section>
  );
}
