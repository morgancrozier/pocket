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
  registrationEnabled?: boolean;
  roomPhase?: RoomPhase;
  viewerStatus?: RoomViewerStatus;
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
  registrationEnabled = true,
  roomPhase,
  viewerStatus = "seated",
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
  const interactionLockedRef = useRef(interactionLocked);
  const roomPhaseRef = useRef(roomPhase);
  const viewerStatusRef = useRef(viewerStatus);
  const [activity, setActivity] = useState<PokerToolActivityState>({
    activeTool: null,
    latest: null,
  });

  situationRef.current = situation;
  historyRef.current = handHistory;
  suggestionHandlerRef.current = onSuggestion;
  revisionCurrentRef.current = isRevisionCurrent;
  interactionLockedRef.current = interactionLocked;
  roomPhaseRef.current = roomPhase;
  viewerStatusRef.current = viewerStatus;

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

  const handNumber = situation?.handNumber;
  const stateVersion = situation?.stateVersion;

  useEffect(() => {
    setActivity({ activeTool: null, latest: null });
  }, [situation?.gameId, handNumber, stateVersion]);

  useEffect(() => {
    if (!registrationEnabled) {
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
            roomPhaseRef.current
              ? {
                  roomPhase: roomPhaseRef.current,
                  viewerStatus: viewerStatusRef.current,
                }
              : null,
        });

        for (const tool of tools) {
          if (controller.signal.aborted) return;
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
  }, [recordActivity, registrationEnabled]);

  useEffect(() => {
    if (!registrationEnabled) {
      setSuggestionRegistrationError(null);
      return;
    }

    if (!hasWebMCP()) {
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
          isInteractionLocked: () => interactionLockedRef.current,
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
  }, [recordActivity, registrationEnabled]);

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
