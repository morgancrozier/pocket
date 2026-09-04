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
  PokerActionIntent,
  PokerSituation,
  PokerStreet,
  RoomPhase,
  RoomViewerStatus,
} from "@/types/poker";

export type WebMCPSupportState = "checking" | "available" | "unavailable" | "error";

export interface PokerToolActivityReceipt {
  tool: PokerToolActivityEvent["tool"];
  status: "completed" | "rejected";
  message?: string;
  handNumber?: number;
  stateVersion?: number;
  street?: PokerStreet;
  recommendation?: PokerActionIntent;
}

export interface PokerToolActivityState {
  activeTool: PokerToolActivityEvent["tool"] | null;
  latest: PokerToolActivityReceipt | null;
  recent: PokerToolActivityReceipt[];
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
  const [readToolsReady, setReadToolsReady] = useState(false);
  const [recommendationToolReady, setRecommendationToolReady] = useState(false);
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
  const latestSuggestionRef = useRef<AgentSuggestion | null>(null);
  const [activity, setActivity] = useState<PokerToolActivityState>({
    activeTool: null,
    latest: null,
    recent: [],
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
      if (event.tool === "stage_recommendation") {
        latestSuggestionRef.current = null;
      }
      setActivity((current) => ({ ...current, activeTool: event.tool }));
      return;
    }

    const currentSituation = situationRef.current;
    const latestSuggestion =
      event.tool === "stage_recommendation"
        ? latestSuggestionRef.current
        : null;
    const recommendationAmount = latestSuggestion
      ? latestSuggestion.action === "call"
        ? (currentSituation?.legalActions.find(
            (action) => action.type === "call",
          )?.amount ?? currentSituation?.toCall)
        : latestSuggestion.amount
      : undefined;
    const receipt: PokerToolActivityReceipt = {
      tool: event.tool,
      status: event.phase,
      message: event.message,
      ...(currentSituation
        ? {
            handNumber: currentSituation.handNumber,
            stateVersion: currentSituation.stateVersion,
            street: currentSituation.street,
          }
        : {}),
      ...(latestSuggestion
        ? {
            recommendation: {
              action: latestSuggestion.action,
              ...(recommendationAmount === undefined
                ? {}
                : { amount: recommendationAmount }),
            },
          }
        : {}),
    };
    setActivity((current) => ({
      activeTool: current.activeTool === event.tool ? null : current.activeTool,
      latest: receipt,
      recent: [...current.recent, receipt].slice(-6),
    }));
  }, []);

  const handNumber = situation?.handNumber;
  const stateVersion = situation?.stateVersion;

  useEffect(() => {
    setActivity({ activeTool: null, latest: null, recent: [] });
  }, [situation?.gameId, handNumber]);

  useEffect(() => {
    setActivity((current) => ({
      ...current,
      activeTool: null,
      latest: null,
    }));
  }, [stateVersion]);

  useEffect(() => {
    if (!registrationEnabled) {
      setAvailabilityState("checking");
      setReadToolsReady(false);
      setReadRegistrationError(null);
      return;
    }

    if (!hasWebMCP()) {
      setAvailabilityState("unavailable");
      setReadToolsReady(false);
      setReadRegistrationError(null);
      return;
    }

    setAvailabilityState("checking");
    setReadToolsReady(false);
    setReadRegistrationError(null);
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
          setReadToolsReady(true);
          setReadRegistrationError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        if (active) {
          setReadToolsReady(false);
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
      setRecommendationToolReady(false);
      setSuggestionRegistrationError(null);
      return;
    }

    if (!hasWebMCP()) {
      setRecommendationToolReady(false);
      setSuggestionRegistrationError(null);
      return;
    }

    setRecommendationToolReady(false);
    setSuggestionRegistrationError(null);
    const controller = new AbortController();
    let active = true;

    async function registerSuggestionTool() {
      try {
        const tool = createStageRecommendationTool({
          getSituation: () => situationRef.current,
          onSuggestion: (suggestion) => {
            latestSuggestionRef.current = suggestion;
            suggestionHandlerRef.current(suggestion);
          },
          onActivity: recordActivity,
          isRevisionCurrent: () => revisionCurrentRef.current?.() ?? true,
          isInteractionLocked: () => interactionLockedRef.current,
        });

        await document.modelContext.registerTool(tool, {
          signal: controller.signal,
        });
        if (active) {
          setRecommendationToolReady(true);
          setSuggestionRegistrationError(null);
        }
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        setRecommendationToolReady(false);
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
    : availabilityState === "unavailable"
      ? "unavailable"
      : availabilityState === "available" &&
          readToolsReady &&
          recommendationToolReady
        ? "available"
        : "checking";

  return {
    supportState,
    registrationError,
    activity,
  };
}
