"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createReadPokerTools,
  createStageRecommendationTool,
  type PokerToolActivityEvent,
} from "@/lib/webmcp/poker-tools";
import type {
  AgentSuggestion,
  HandActionEvent,
  PokerSituation,
  RoomPhase,
  RoomViewerStatus,
} from "@/types/poker";

export type WebMCPSupportState = "checking" | "available" | "unavailable" | "error";

export interface PokerToolActivityReceipt {
  tool: PokerToolActivityEvent["tool"];
  status: "completed" | "rejected";
  message?: string;
}

export interface PokerToolActivityState {
  activeTool: PokerToolActivityEvent["tool"] | null;
  latest: PokerToolActivityReceipt | null;
}

interface UsePokerToolsInput {
  situation: PokerSituation | null;
  handHistory: HandActionEvent[];
  onSuggestion: (suggestion: AgentSuggestion) => void;
  roomPhase?: RoomPhase;
  viewerStatus?: RoomViewerStatus;
  observedRevision?: number;
  isRevisionCurrent?: () => boolean;
  interactionLocked?: boolean;
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
  interactionLocked = false,
}: UsePokerToolsInput) {
  const [availabilityState, setAvailabilityState] =
    useState<WebMCPSupportState>("checking");
  const [readRegistrationError, setReadRegistrationError] = useState<
    string | null
  >(null);
  const [suggestionRegistrationError, setSuggestionRegistrationError] =
    useState<string | null>(null);

  const situationRef = useRef(situation);
  const historyRef = useRef(handHistory);
  const suggestionHandlerRef = useRef(onSuggestion);
  const revisionCurrentRef = useRef(isRevisionCurrent);
  const [activity, setActivity] = useState<PokerToolActivityState>({
    activeTool: null,
    latest: null,
  });

  situationRef.current = situation;
  historyRef.current = handHistory;
  suggestionHandlerRef.current = onSuggestion;
  revisionCurrentRef.current = isRevisionCurrent;

  const recordActivity = useCallback((event: PokerToolActivityEvent) => {
    if (event.phase === "started") {
      setActivity((current) => ({ ...current, activeTool: event.tool }));
      return;
    }

    const receipt: PokerToolActivityReceipt = {
      tool: event.tool,
      status: event.phase,
      message: event.message,
    };
    setActivity((current) => ({
      activeTool: current.activeTool === event.tool ? null : current.activeTool,
      latest: receipt,
    }));
  }, []);

  const hasSituation = situation !== null;
  const isYourTurn = situation?.isYourTurn ?? false;
  const isTerminal = Boolean(situation?.gameResult);
  const handNumber = situation?.handNumber;
  const stateVersion = situation?.stateVersion;
  const canSuggest =
    (observedRevision === undefined ||
      (stateVersion !== undefined && stateVersion >= observedRevision)) &&
    viewerStatus === "seated" &&
    !interactionLocked &&
    (roomPhase === undefined || roomPhase === "active");

  useEffect(() => {
    setActivity({ activeTool: null, latest: null });
  }, [situation?.gameId, handNumber, stateVersion]);

  useEffect(() => {
    if (!hasSituation) {
      setAvailabilityState("checking");
      setReadRegistrationError(null);
      return;
    }

    if (!hasWebMCP()) {
      setAvailabilityState("unavailable");
      setReadRegistrationError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function registerReadTools() {
      try {
        const tools = createReadPokerTools({
          getSituation: () => situationRef.current,
          getHandHistory: () => historyRef.current,
          onActivity: recordActivity,
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
          setAvailabilityState("available");
          setReadRegistrationError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        if (active) {
          setReadRegistrationError(
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
      setSuggestionRegistrationError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function registerSuggestionTool() {
      try {
        const tool = createStageRecommendationTool({
          getSituation: () => situationRef.current,
          onSuggestion: (suggestion) =>
            suggestionHandlerRef.current(suggestion),
          onActivity: recordActivity,
          isRevisionCurrent: () => revisionCurrentRef.current?.() ?? true,
        });

        await document.modelContext.registerTool(tool, {
          signal: controller.signal,
        });
        if (active) setSuggestionRegistrationError(null);
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        setSuggestionRegistrationError(
          error instanceof Error
            ? error.message
            : "stage_recommendation registration failed.",
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
    interactionLocked,
    handNumber,
    observedRevision,
    stateVersion,
  ]);

  const registrationError =
    suggestionRegistrationError ?? readRegistrationError;
  const supportState: WebMCPSupportState = registrationError
    ? "error"
    : availabilityState;

  return {
    supportState,
    registrationError,
    activity,
  };
}
