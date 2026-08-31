"use client";

import { useEffect, useRef, useState } from "react";
import { isSuggestionLegal } from "@/lib/poker/mock-state";
import type {
  AgentSuggestion,
  HandActionEvent,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

export type WebMCPSupportState = "checking" | "available" | "unavailable" | "error";

interface UsePokerToolsInput {
  situation: PokerSituation;
  handHistory: HandActionEvent[];
  onSuggestion: (suggestion: AgentSuggestion) => void;
}

function hasWebMCP(): boolean {
  return (
    typeof document !== "undefined" &&
    "modelContext" in document &&
    Boolean(document.modelContext)
  );
}

function parseAction(value: unknown): PokerActionType | null {
  if (
    value === "fold" ||
    value === "check" ||
    value === "call" ||
    value === "bet" ||
    value === "raise"
  ) {
    return value;
  }

  return null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

export function usePokerTools({
  situation,
  handHistory,
  onSuggestion,
}: UsePokerToolsInput) {
  const [supportState, setSupportState] = useState<WebMCPSupportState>("checking");
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const situationRef = useRef(situation);
  const historyRef = useRef(handHistory);
  const suggestionHandlerRef = useRef(onSuggestion);

  useEffect(() => {
    situationRef.current = situation;
  }, [situation]);

  useEffect(() => {
    historyRef.current = handHistory;
  }, [handHistory]);

  useEffect(() => {
    suggestionHandlerRef.current = onSuggestion;
  }, [onSuggestion]);

  useEffect(() => {
    if (!hasWebMCP()) {
      setSupportState("unavailable");
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function registerReadTools() {
      try {
        await document.modelContext.registerTool(
          {
            name: "get_current_situation",
            description:
              "Read the exact current Texas Hold'em situation for the human player in this browser. Returns only information this seat is allowed to know, including the player's cards, board, pot, stacks, recent public actions, and legal actions. Re-read it whenever the table changes before making a recommendation.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
              untrustedContentHint: true,
            },
            execute: async () => JSON.stringify(situationRef.current),
          },
          { signal: controller.signal },
        );

        await document.modelContext.registerTool(
          {
            name: "get_hand_history",
            description:
              "Read the chronological public action history for the current poker hand. Use this to understand how betting reached the current state. It never reveals hidden cards.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
              untrustedContentHint: true,
            },
            execute: async () =>
              JSON.stringify({
                gameId: situationRef.current.gameId,
                handNumber: situationRef.current.handNumber,
                stateVersion: situationRef.current.stateVersion,
                actions: historyRef.current,
              }),
          },
          { signal: controller.signal },
        );

        if (active) {
          setSupportState("available");
          setRegistrationError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (active) {
          setSupportState("error");
          setRegistrationError(
            error instanceof Error ? error.message : "WebMCP registration failed.",
          );
        }
      }
    }

    void registerReadTools();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!hasWebMCP() || !situation.isYourTurn) {
      return;
    }

    const controller = new AbortController();

    async function registerSuggestionTool() {
      try {
        await document.modelContext.registerTool(
          {
            name: "suggest_action",
            description:
              "Place a poker recommendation into the human player's visible Pocket interface. This tool never plays the action. Use get_current_situation first, then suggest one currently legal action. The human will decide whether to follow it.",
            inputSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["fold", "check", "call", "bet", "raise"],
                  description:
                    "The legal poker action to recommend to the human player.",
                },
                amount: {
                  type: "number",
                  description:
                    "Required for bet or raise. Must be within the current minimum and maximum returned by get_current_situation.",
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description:
                    "Optional confidence from 0 to 1. This is displayed as supporting context, not treated as certainty.",
                },
              },
              required: ["action"],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: false,
              untrustedContentHint: false,
            },
            execute: async (input) => {
              const current = situationRef.current;
              const action = parseAction(input.action);

              if (!action) {
                throw new Error(
                  "Invalid action. Use fold, check, call, bet, or raise.",
                );
              }

              const amount = optionalFiniteNumber(input.amount);
              const confidence = optionalFiniteNumber(input.confidence);
              const validation = isSuggestionLegal(current, { action, amount });

              if (!validation.ok) {
                throw new Error(
                  `${validation.reason} Re-read get_current_situation because the table may have changed.`,
                );
              }

              const suggestion: AgentSuggestion = {
                handNumber: current.handNumber,
                stateVersion: current.stateVersion,
                action,
                amount,
                confidence:
                  typeof confidence === "number"
                    ? Math.max(0, Math.min(1, confidence))
                    : undefined,
              };

              suggestionHandlerRef.current(suggestion);

              return JSON.stringify({
                ok: true,
                message:
                  "The recommendation is visible in Pocket. No poker action was executed; the human still decides.",
                suggestion,
              });
            },
          },
          { signal: controller.signal },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setRegistrationError(
          error instanceof Error ? error.message : "suggest_action registration failed.",
        );
      }
    }

    void registerSuggestionTool();

    return () => controller.abort();
  }, [situation.isYourTurn, situation.handNumber, situation.stateVersion]);

  return {
    supportState,
    registrationError,
  };
}
