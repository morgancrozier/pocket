"use client";

import { useEffect, useRef, useState } from "react";
import {
  createReadPokerTools,
  createSuggestActionTool,
} from "@/lib/webmcp/poker-tools";
import type {
  AgentSuggestion,
  HandActionEvent,
  PokerSituation,
  RoomPhase,
  RoomViewerStatus,
} from "@/types/poker";

export type WebMCPSupportState = "checking" | "available" | "unavailable" | "error";

interface UsePokerToolsInput {
  situation: PokerSituation | null;
  handHistory: HandActionEvent[];
  onSuggestion: (suggestion: AgentSuggestion) => void;
  roomPhase?: RoomPhase;
  viewerStatus?: RoomViewerStatus;
  observedRevision?: number;
  isRevisionCurrent?: () => boolean;
}

function hasWebMCP(): boolean {
  return (
    typeof document !== "undefined" &&
    "modelContext" in document &&
    Boolean(document.modelContext)
  );
}

export function usePokerTools({
  situation,
  handHistory,
  onSuggestion,
  roomPhase,
  viewerStatus = "seated",
  observedRevision,
  isRevisionCurrent,
}: UsePokerToolsInput) {
  const [supportState, setSupportState] = useState<WebMCPSupportState>("checking");
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const situationRef = useRef(situation);
  const historyRef = useRef(handHistory);
  const suggestionHandlerRef = useRef(onSuggestion);
  const revisionCurrentRef = useRef(isRevisionCurrent);

  situationRef.current = situation;
  historyRef.current = handHistory;
  suggestionHandlerRef.current = onSuggestion;
  revisionCurrentRef.current = isRevisionCurrent;

  const hasSituation = situation !== null;
  const isYourTurn = situation?.isYourTurn ?? false;
  const isTerminal = Boolean(situation?.gameResult);
  const handNumber = situation?.handNumber;
  const stateVersion = situation?.stateVersion;
  const canSuggest =
    (observedRevision === undefined ||
      (stateVersion !== undefined && stateVersion >= observedRevision)) &&
    viewerStatus === "seated" &&
    (roomPhase === undefined || roomPhase === "active");

  useEffect(() => {
    if (!hasSituation) {
      setSupportState("checking");
      setRegistrationError(null);
      return;
    }

    if (!hasWebMCP()) {
      setSupportState("unavailable");
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function registerReadTools() {
      try {
        const tools = createReadPokerTools({
          getSituation: () => situationRef.current,
          getHandHistory: () => historyRef.current,
          getRoomContext: () =>
            roomPhase
              ? { roomPhase, viewerStatus }
              : null,
        });

        for (const tool of tools) {
          await document.modelContext.registerTool(tool, {
            signal: controller.signal,
          });
        }

        if (active) {
          setSupportState("available");
          setRegistrationError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
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
  }, [hasSituation, roomPhase, viewerStatus]);

  useEffect(() => {
    if (
      !hasSituation ||
      !isYourTurn ||
      isTerminal ||
      !canSuggest ||
      !hasWebMCP()
    ) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function registerSuggestionTool() {
      try {
        const tool = createSuggestActionTool({
          getSituation: () => situationRef.current,
          onSuggestion: (suggestion) =>
            suggestionHandlerRef.current(suggestion),
          isRevisionCurrent: () => revisionCurrentRef.current?.() ?? true,
        });

        await document.modelContext.registerTool(tool, {
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        setRegistrationError(
          error instanceof Error
            ? error.message
            : "suggest_action registration failed.",
        );
      }
    }

    void registerSuggestionTool();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    canSuggest,
    hasSituation,
    isYourTurn,
    isTerminal,
    handNumber,
    observedRevision,
    stateVersion,
  ]);

  return {
    supportState,
    registrationError,
  };
}
