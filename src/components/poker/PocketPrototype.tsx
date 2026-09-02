"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { CompanionRail } from "@/components/poker/CompanionRail";
import { DebugPanel } from "@/components/poker/DebugPanel";
import { HandActionFeed } from "@/components/poker/HandActionFeed";
import { HumanActionDock } from "@/components/poker/HumanActionDock";
import { PokerTableSurface } from "@/components/poker/PokerTableSurface";
import {
  advanceMockStreet,
  appendEvent,
  INITIAL_SITUATION,
  isDebugPanelRequested,
  isMockFallbackRequested,
  nextMockBoard,
  nextMockLegalActions,
} from "@/lib/poker/mock-state";
import {
  createDecisionPresentation,
  describeAction,
} from "@/lib/poker/decision-presentation";
import {
  describeTransitionCatchUp,
  describeTransitionFrame,
  transitionFrameDelay,
} from "@/lib/poker/transition-playback";
import {
  createRecommendationReceipt,
  isRecommendationReceiptCurrent,
  RECOMMENDATION_RECEIPT_STORAGE_KEY,
  restoreRecommendationReceipt,
  serializeRecommendationReceipt,
  type RecommendationReceipt,
} from "@/lib/poker/recommendation-receipt";
import {
  AGENT_SUGGESTION_STORAGE_KEY,
  isSuggestionCurrent,
  restoreStoredSuggestion,
  serializeStoredSuggestion,
} from "@/lib/poker/suggestion-storage";
import {
  ensureSupabaseBrowserIdentity,
  resetSupabaseBrowserIdentity,
  SupabaseIdentityError,
} from "@/lib/supabase/client";
import {
  usePokerTools,
  type WebMCPSupportState,
} from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
  PokerTransitionResult,
} from "@/types/poker";

type DemoMode = "engine" | "loading" | "mock";

const TRANSITION_PLAYBACK_STORAGE_KEY = "pocket:transition-playback";

function readPlaybackMarker(): {
  gameId: string;
  finalStateVersion: number;
} | null {
  const serialized = sessionStorage.getItem(TRANSITION_PLAYBACK_STORAGE_KEY);
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as {
      gameId?: unknown;
      finalStateVersion?: unknown;
    };
    return typeof value.gameId === "string" &&
      Number.isSafeInteger(value.finalStateVersion)
      ? {
          gameId: value.gameId,
          finalStateVersion: Number(value.finalStateVersion),
        }
      : null;
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function supportLabel(
  supportState: WebMCPSupportState,
  isPracticeFallback: boolean,
): string {
  const label =
    supportState === "available"
      ? "WebMCP tools ready"
      : supportState === "unavailable"
        ? "WebMCP unavailable"
        : supportState === "error"
          ? "WebMCP needs attention"
          : "Preparing WebMCP";
  return isPracticeFallback ? `Practice fallback · ${label}` : label;
}

/**
 * The judge run id is captured once at mount so every demo request targets the
 * same authoritative game even if the address bar is later rewritten by the
 * router; the URL copy exists for refresh and sharing, not as the source.
 */
function demoApiUrl(path: string, judgeRun: string | null): string {
  if (typeof window === "undefined") return path;
  const current = new URLSearchParams(window.location.search);
  if (judgeRun === null && current.get("demo") !== "judge") return path;
  const query = new URLSearchParams({ demo: "judge" });
  const run = judgeRun ?? current.get("run");
  if (run) query.set("run", run);
  return `${path}?${query.toString()}`;
}

function ensureJudgeDemoRun(): string | null {
  const url = new URL(window.location.href);
  if (url.searchParams.get("demo") !== "judge") return null;
  const existing = url.searchParams.get("run");
  if (existing) return existing;
  const run = crypto.randomUUID();
  url.searchParams.set("run", run);
  window.history.replaceState(window.history.state, "", url);
  return run;
}

function PocketHeader({
  supportState,
  situation,
  isPracticeFallback = false,
}: {
  supportState: WebMCPSupportState;
  situation: PokerSituation | null;
  isPracticeFallback?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <h1>
          <Link className="brand-home-link" href="/" aria-label="Pocket home">
            Pocket
          </Link>
        </h1>
        <p className="tagline">Every seat has two minds.</p>
      </div>
      <div className="status-stack">
        <span className="status-pill" data-state={supportState}>
          <span className="status-dot" />
          {supportLabel(supportState, isPracticeFallback)}
        </span>
        {situation ? (
          <span className="header-game-meta">
            <span>Hand {situation.handNumber}</span>
            <span aria-hidden="true">·</span>
            <span>
              Blinds {situation.smallBlind} / {situation.bigBlind}
            </span>
          </span>
        ) : (
          <span className="trust-line">Your agent advises. You play.</span>
        )}
      </div>
    </header>
  );
}

function isPokerSituation(value: unknown): value is PokerSituation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PokerSituation>;
  return (
    typeof candidate.gameId === "string" &&
    typeof candidate.stateVersion === "number" &&
    typeof candidate.smallBlind === "number" &&
    typeof candidate.bigBlind === "number" &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.yourCards) &&
    Array.isArray(candidate.legalActions)
  );
}

function isPokerTransitionResult(value: unknown): value is PokerTransitionResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PokerTransitionResult>;
  return (
    isPokerSituation(candidate.situation) &&
    Array.isArray(candidate.frames) &&
    candidate.frames.every(isPokerSituation)
  );
}

class DemoRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "DemoRequestError";
    this.code = code;
  }
}

function practiceFallbackMessage(error: unknown, retried = false): string {
  const reason =
    error instanceof Error && error.message ? ` (${error.message})` : "";
  return retried
    ? `The authoritative live table is still unavailable${reason}. This remains a practice hand only.`
    : `The authoritative live table is unavailable${reason}. This is a practice hand only.`;
}

async function requestSituation(
  url: string,
  init?: RequestInit,
): Promise<PokerSituation> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
        ? (payload.error as { code?: unknown; message?: unknown })
        : null;
    throw new DemoRequestError(
      typeof error?.message === "string"
        ? error.message
        : "The table could not complete that request.",
      typeof error?.code === "string" ? error.code : null,
    );
  }

  if (!isPokerSituation(payload)) {
    throw new Error("Pocket could not refresh this hand.");
  }

  return payload;
}

async function requestTransition(
  url: string,
  init: RequestInit,
): Promise<PokerTransitionResult> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
        ? (payload.error as { code?: unknown; message?: unknown })
        : null;
    throw new DemoRequestError(
      typeof error?.message === "string"
        ? error.message
        : "The table could not complete that request.",
      typeof error?.code === "string" ? error.code : null,
    );
  }

  if (!isPokerTransitionResult(payload)) {
    throw new Error("Pocket could not follow the table action.");
  }

  return payload;
}

function chips(amount: number): string {
  return `${amount} chip${amount === 1 ? "" : "s"}`;
}

function resultMessage(situation: PokerSituation): string {
  if (situation.gameResult?.outcome === "won") {
    return "You won the table. Every opponent is out.";
  }
  if (situation.gameResult?.outcome === "lost") {
    return "You’re out. The tournament ends here.";
  }
  if (!situation.handResult) return "The bots acted. Your turn again.";
  const winners = situation.handResult.winners
    .map(
      (winner) =>
        `${winner.playerId === situation.yourPlayerId ? "You win" : `${winner.playerName} wins`} ${chips(winner.amount)}`,
    )
    .join(" · ");
  return winners ? `${winners}.` : "The hand settled.";
}

function actionPendingMessage(
  receipt: RecommendationReceipt | null,
): string {
  if (!receipt) return "Action sent. The table is responding…";
  if (receipt.outcome === "followed") {
    return "Copilot recommendation sent. The table is responding…";
  }

  return "Your choice is sent. The table is responding…";
}

export function PocketPrototype() {
  const [situation, setSituation] = useState<PokerSituation | null>(null);
  const [mode, setMode] = useState<DemoMode>("loading");
  const [isPracticeFallback, setIsPracticeFallback] = useState(false);
  const [isRetryingLive, setIsRetryingLive] = useState(false);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [recommendationReceipt, setRecommendationReceipt] =
    useState<RecommendationReceipt | null>(null);
  const [suggestionPresentationRevision, setSuggestionPresentationRevision] =
    useState(0);
  const [tableMessage, setTableMessage] = useState<string | null>(
    "Preparing your first hand…",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPlayingTransition, setIsPlayingTransition] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(
    "Following the table action…",
  );
  const [betDraft, setBetDraft] = useState("");
  const [betDraftError, setBetDraftError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextHandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackResolveRef = useRef<(() => void) | null>(null);
  const playbackGenerationRef = useRef(0);
  const playbackFinalRef = useRef<PokerSituation | null>(null);
  const playbackActiveRef = useRef(false);
  const displayedSituationRef = useRef<PokerSituation | null>(null);
  const authoritativeSituationRef = useRef<PokerSituation | null>(null);
  const botAdvanceVersionRef = useRef<number | null>(null);
  const autoNextHandVersionRef = useRef<number | null>(null);
  const judgeRunRef = useRef<string | null>(null);
  const suggestionRef = useRef<AgentSuggestion | null>(null);
  suggestionRef.current = suggestion;
  displayedSituationRef.current = situation;

  const clearSuggestion = useCallback(() => {
    sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion(null);
  }, []);

  const clearRecommendationReceipt = useCallback(() => {
    sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    setRecommendationReceipt(null);
  }, []);

  const acceptRecommendationReceipt = useCallback(
    (receipt: RecommendationReceipt | null) => {
      if (!receipt) return;
      sessionStorage.setItem(
        RECOMMENDATION_RECEIPT_STORAGE_KEY,
        serializeRecommendationReceipt(receipt),
      );
      setRecommendationReceipt(receipt);
    },
    [],
  );

  const cancelPlayback = useCallback(
    (options: { renderFinal?: boolean; message?: string } = {}) => {
      playbackGenerationRef.current += 1;
      if (playbackTimerRef.current) {
        clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      const resolve = playbackResolveRef.current;
      playbackResolveRef.current = null;
      resolve?.();

      const final = playbackFinalRef.current;
      playbackFinalRef.current = null;
      playbackActiveRef.current = false;
      sessionStorage.removeItem(TRANSITION_PLAYBACK_STORAGE_KEY);
      setIsPlayingTransition(false);
      setPlaybackStatus("Following the table action…");

      if (options.renderFinal && final) {
        const previous = displayedSituationRef.current ?? final;
        displayedSituationRef.current = final;
        setSituation(final);
        setTableMessage(
          options.message ??
            describeTransitionCatchUp(previous, final),
        );
      }
    },
    [],
  );

  const presentTransition = useCallback(
    async (
      transition: PokerTransitionResult,
    ): Promise<"completed" | "reduced" | "cancelled"> => {
      if (
        authoritativeSituationRef.current &&
        authoritativeSituationRef.current.stateVersion >
          transition.situation.stateVersion
      ) {
        return "cancelled";
      }
      const starting = displayedSituationRef.current ?? transition.situation;
      cancelPlayback();
      authoritativeSituationRef.current = transition.situation;

      const orderedFrames = transition.frames
        .filter((frame) => frame.stateVersion > starting.stateVersion)
        .toSorted((left, right) => left.stateVersion - right.stateVersion);
      if (
        transition.situation.stateVersion > starting.stateVersion &&
        orderedFrames.at(-1)?.stateVersion !== transition.situation.stateVersion
      ) {
        orderedFrames.push(transition.situation);
      }

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (prefersReducedMotion || orderedFrames.length === 0) {
        displayedSituationRef.current = transition.situation;
        setSituation(transition.situation);
        setTableMessage(
          describeTransitionCatchUp(starting, transition.situation),
        );
        return prefersReducedMotion ? "reduced" : "completed";
      }

      const generation = playbackGenerationRef.current;
      playbackFinalRef.current = transition.situation;
      playbackActiveRef.current = true;
      sessionStorage.setItem(
        TRANSITION_PLAYBACK_STORAGE_KEY,
        JSON.stringify({
          gameId: transition.situation.gameId,
          finalStateVersion: transition.situation.stateVersion,
        }),
      );
      setIsPlayingTransition(true);

      let previous = starting;
      for (const [index, frame] of orderedFrames.entries()) {
        const previousSequence = previous.recentActions.reduce(
          (latest, event) => Math.max(latest, event.sequence),
          0,
        );
        const newAction = frame.recentActions.find(
          (event) => event.sequence > previousSequence && event.action !== "deal",
        );
        const showImmediately =
          index === 0 &&
          (frame.handNumber !== previous.handNumber ||
            newAction?.playerId === frame.yourPlayerId);

        if (!showImmediately) {
          await new Promise<void>((resolve) => {
            playbackResolveRef.current = resolve;
            playbackTimerRef.current = setTimeout(() => {
              playbackTimerRef.current = null;
              playbackResolveRef.current = null;
              resolve();
            }, transitionFrameDelay(previous, frame, orderedFrames.length));
          });
        }

        if (playbackGenerationRef.current !== generation) return "cancelled";
        const message = describeTransitionFrame(previous, frame);
        displayedSituationRef.current = frame;
        setSituation(frame);
        setPlaybackStatus(message);
        setTableMessage(message);
        previous = frame;
      }

      if (playbackGenerationRef.current !== generation) return "cancelled";
      displayedSituationRef.current = transition.situation;
      setSituation(transition.situation);
      playbackFinalRef.current = null;
      playbackActiveRef.current = false;
      sessionStorage.removeItem(TRANSITION_PLAYBACK_STORAGE_KEY);
      setIsPlayingTransition(false);
      setPlaybackStatus("Following the table action…");
      return "completed";
    },
    [cancelPlayback],
  );

  const skipPlayback = useCallback(() => {
    const final = playbackFinalRef.current;
    const current = displayedSituationRef.current;
    if (!final || !current) return;
    cancelPlayback({
      renderFinal: true,
      message: describeTransitionCatchUp(current, final),
    });
  }, [cancelPlayback]);

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation || playbackActiveRef.current || isSubmitting) return;
      if (!isSuggestionCurrent(situation, next)) return;
      clearRecommendationReceipt();
      setSuggestion(next);
      setSuggestionPresentationRevision((current) => current + 1);
    },
    [clearRecommendationReceipt, isSubmitting, situation],
  );

  const { supportState, registrationError, activity } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
    interactionLocked: isSubmitting || isPlayingTransition,
  });

  const loadEngineSituation = useCallback(
    async (options: { keepMessage?: boolean } = {}) => {
      // Read this before the first await so concurrent Strict Mode loads retain
      // the same interrupted-playback marker until either response reconciles.
      const playbackMarker = readPlaybackMarker();
      try {
        await ensureSupabaseBrowserIdentity();
      } catch (error) {
        // The server decides whether a cookie it issued is still valid.
        if (
          !(
            error instanceof SupabaseIdentityError &&
            error.code === "SESSION_EXPIRED"
          )
        ) {
          throw error;
        }
      }

      const url = demoApiUrl("/api/games/demo/state", judgeRunRef.current);
      let next: PokerSituation;
      try {
        next = await requestSituation(url);
      } catch (error) {
        if (
          !(
            error instanceof DemoRequestError &&
            error.code === "DEMO_SESSION_EXPIRED"
          )
        ) {
          throw error;
        }
        // The stored anonymous session is dead: start a fresh seat once.
        await resetSupabaseBrowserIdentity();
        await ensureSupabaseBrowserIdentity();
        next = await requestSituation(url);
      }

      const previous = displayedSituationRef.current;
      const interruptedPlayback = playbackActiveRef.current;
      const recoveredPlayback =
        playbackMarker?.gameId === next.gameId &&
        next.stateVersion >= playbackMarker.finalStateVersion;
      cancelPlayback();
      authoritativeSituationRef.current = next;
      displayedSituationRef.current = next;
      setSituation(next);
      setMode("engine");
      setIsPracticeFallback(false);
      if (!options.keepMessage) {
        setTableMessage(
          recoveredPlayback || interruptedPlayback
            ? describeTransitionCatchUp(previous ?? next, next)
            : next.gameResult || next.handResult
              ? resultMessage(next)
              : null,
        );
      }
      return next;
    },
    [cancelPlayback],
  );

  const advanceEngineBots = useCallback(
    async (starting: PokerSituation) => {
      if (isSubmitting || playbackActiveRef.current) return;
      setIsSubmitting(true);
      const actor = starting.players.find(
        (player) => player.id === starting.currentActorId,
      );
      setTableMessage(
        actor
          ? `Cards are dealt. ${actor.displayName} is first to act…`
          : "Following the opening action…",
      );

      try {
        const transition = await requestTransition(
          demoApiUrl("/api/games/demo/advance", judgeRunRef.current),
          {
            method: "POST",
            body: JSON.stringify({
              expectedStateVersion: starting.stateVersion,
            }),
          },
        );
        const playback = await presentTransition(transition);
        if (playback === "completed" && transition.situation.isYourTurn) {
          setTableMessage(null);
        }
      } catch (error) {
        setTableMessage(
          error instanceof Error
            ? error.message
            : "Pocket could not follow the opening action.",
        );
        try {
          await loadEngineSituation({ keepMessage: true });
        } catch {
          // Keep the newest player-safe frame visible if refresh also fails.
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, loadEngineSituation, presentTransition],
  );

  useEffect(() => {
    let active = true;
    judgeRunRef.current = ensureJudgeDemoRun();
    const forceMock = isMockFallbackRequested(window.location.search);
    setShowDebug(isDebugPanelRequested(window.location.search));

    if (forceMock) {
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setIsPracticeFallback(false);
      setTableMessage(null);
      return () => {
        active = false;
      };
    }

    void loadEngineSituation().catch((error: unknown) => {
      if (!active) return;
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setIsPracticeFallback(true);
      setTableMessage(practiceFallbackMessage(error));
    });

    return () => {
      active = false;
    };
  }, [loadEngineSituation]);

  useEffect(() => {
    if (
      mode !== "engine" ||
      !situation ||
      situation.isYourTurn ||
      situation.handResult ||
      situation.gameResult ||
      isSubmitting ||
      isPlayingTransition ||
      botAdvanceVersionRef.current === situation.stateVersion
    ) {
      return;
    }

    const actor = situation.players.find(
      (player) => player.id === situation.currentActorId,
    );
    if (!actor?.isBot) return;

    botAdvanceVersionRef.current = situation.stateVersion;
    void advanceEngineBots(situation);
  }, [advanceEngineBots, isPlayingTransition, isSubmitting, mode, situation]);

  useEffect(() => {
    if (!situation) return;

    const previous = suggestionRef.current;
    const restored = restoreStoredSuggestion(
      sessionStorage.getItem(AGENT_SUGGESTION_STORAGE_KEY),
      situation,
    );
    if (!restored) {
      sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    }

    setSuggestion(
      previous && isSuggestionCurrent(situation, previous) ? previous : restored,
    );
  }, [situation?.gameId, situation?.handNumber, situation?.stateVersion]);

  useEffect(() => {
    if (!situation || !suggestion) return;
    const serialized = serializeStoredSuggestion(situation, suggestion);
    if (serialized) {
      sessionStorage.setItem(AGENT_SUGGESTION_STORAGE_KEY, serialized);
    }
  }, [situation, suggestion]);

  useEffect(() => {
    if (!situation) return;

    const restored = restoreRecommendationReceipt(
      sessionStorage.getItem(RECOMMENDATION_RECEIPT_STORAGE_KEY),
      situation,
    );
    if (!restored) {
      sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    }

    setRecommendationReceipt((current) =>
      current && isRecommendationReceiptCurrent(situation, current)
        ? current
        : restored,
    );
  }, [situation?.gameId, situation?.handNumber, situation?.stateVersion]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
      playbackGenerationRef.current += 1;
      if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
      playbackResolveRef.current?.();
    };
  }, []);

  const currentPlayer = useMemo(
    () =>
      situation?.players.find(
        (player) => player.id === situation.currentActorId,
      ) ?? null,
    [situation],
  );
  const sizedAction = useMemo(
    () =>
      situation?.legalActions.find(
        (action) => action.type === "bet" || action.type === "raise",
      ) ?? null,
    [situation],
  );
  const decisionPresentation = useMemo(
    () =>
      situation
        ? createDecisionPresentation(situation, {
            isComplete: Boolean(situation.gameResult),
          })
        : null,
    [situation],
  );
  useEffect(() => {
    setBetDraft(
      typeof sizedAction?.minTotal === "number"
        ? String(sizedAction.minTotal)
        : "",
    );
    setBetDraftError(null);
  }, [
    situation?.gameId,
    situation?.handNumber,
    situation?.stateVersion,
    sizedAction?.type,
    sizedAction?.minTotal,
  ]);

  useEffect(() => {
    if (
      !situation ||
      !suggestion ||
      suggestion.handNumber !== situation.handNumber ||
      suggestion.stateVersion !== situation.stateVersion
    ) {
      return;
    }
    if (
      sizedAction &&
      suggestion.action === sizedAction.type &&
      typeof suggestion.amount === "number"
    ) {
      setBetDraft(String(suggestion.amount));
      setBetDraftError(null);
    }
  }, [
    situation?.handNumber,
    situation?.stateVersion,
    sizedAction?.type,
    suggestion?.action,
    suggestion?.amount,
    suggestion?.handNumber,
    suggestion?.stateVersion,
    suggestionPresentationRevision,
  ]);

  const commitMockAction = useCallback(
    (
      action: PokerActionType,
      amount: number | undefined,
      receipt: RecommendationReceipt | null,
    ) => {
      if (!situation?.isYourTurn) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      clearSuggestion();
      acceptRecommendationReceipt(receipt);
      setTableMessage(actionPendingMessage(receipt));

      setSituation((current) =>
        current
          ? {
              ...current,
              stateVersion: current.stateVersion + 1,
              isYourTurn: false,
              currentActorId: "alex",
              recentActions: appendEvent(current.recentActions, {
                street: current.street,
                playerId: current.yourPlayerId,
                playerName: "Morgan",
                action,
                amount,
              }),
            }
          : current,
      );

      timerRef.current = setTimeout(() => {
        setSituation((current) => {
          if (!current) return current;
          const nextStreet = advanceMockStreet(current.street);
          const reachedShowdown = nextStreet === "showdown";
          const nextActions = appendEvent(current.recentActions, {
            street: current.street,
            playerId: "alex",
            playerName: "Alex",
            action: current.street === "flop" ? "call" : "check",
            amount: current.street === "flop" ? amount : undefined,
          });

          return {
            ...current,
            stateVersion: current.stateVersion + 1,
            street: nextStreet,
            board: nextMockBoard(current.street, current.board),
            pot:
              current.pot +
              (typeof amount === "number"
                ? Math.min(amount, current.yourStack)
                : 0) +
              (current.street === "flop" && typeof amount === "number"
                ? amount
                : 0),
            currentBet: 0,
            toCall: 0,
            isYourTurn: !reachedShowdown,
            currentActorId: reachedShowdown ? null : current.yourPlayerId,
            legalActions: nextMockLegalActions(current.street),
            players: current.players.map((player) => ({
              ...player,
              committedThisStreet: 0,
            })),
            recentActions: nextActions,
          };
        });

        setTableMessage(
          action === "fold"
            ? "This practice hand ends here."
            : receipt
              ? "Your copilot decision remains recorded for this hand."
              : null,
        );
      }, 900);
    },
    [acceptRecommendationReceipt, clearSuggestion, situation],
  );

  const commitEngineAction = useCallback(
    async (
      action: PokerActionType,
      amount: number | undefined,
      receipt: RecommendationReceipt | null,
    ) => {
      if (!situation?.isYourTurn || isSubmitting) return;
      setIsSubmitting(true);
      setTableMessage(actionPendingMessage(receipt));

      try {
        const transition = await requestTransition(
          demoApiUrl("/api/games/demo/action", judgeRunRef.current),
          {
            method: "POST",
            body: JSON.stringify({
              action,
              ...(action === "bet" || action === "raise" ? { amount } : {}),
              expectedStateVersion: situation.stateVersion,
            }),
          },
        );
        clearSuggestion();
        acceptRecommendationReceipt(receipt);
        const playback = await presentTransition(transition);
        if (playback === "completed") {
          const next = transition.situation;
          setTableMessage(
            next.handResult
              ? next.gameResult
                ? resultMessage(next)
                : `${resultMessage(next)} The next hand starts shortly.`
              : null,
          );
        }
      } catch (error) {
        setTableMessage(
          error instanceof Error ? error.message : "The action was rejected.",
        );
        try {
          await loadEngineSituation({ keepMessage: true });
        } catch {
          // Keep the last known safe state visible if a refresh also fails.
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      acceptRecommendationReceipt,
      clearSuggestion,
      isSubmitting,
      loadEngineSituation,
      presentTransition,
      situation,
    ],
  );

  const commitHumanAction = useCallback(
    (action: PokerActionType, amount?: number) => {
      if (!situation) return;

      const currentSuggestion =
        suggestion && isSuggestionCurrent(situation, suggestion)
          ? suggestion
          : null;
      const receipt = currentSuggestion
        ? createRecommendationReceipt(situation, currentSuggestion, {
            action,
            amount,
          })
        : null;

      if (mode === "mock") {
        commitMockAction(action, amount, receipt);
        return;
      }
      if (mode === "engine") {
        void commitEngineAction(action, amount, receipt);
      }
    },
    [commitEngineAction, commitMockAction, mode, situation, suggestion],
  );

  function submitSizedAction() {
    if (!sizedAction) return;

    if (!/^\d+$/.test(betDraft)) {
      setBetDraftError("Enter a whole-chip amount.");
      return;
    }

    const amount = Number(betDraft);
    if (!Number.isSafeInteger(amount)) {
      setBetDraftError("Enter a whole-chip amount.");
      return;
    }
    if (
      typeof sizedAction.minTotal === "number" &&
      amount < sizedAction.minTotal
    ) {
      setBetDraftError(`Minimum total is ${chips(sizedAction.minTotal)}.`);
      return;
    }
    if (
      typeof sizedAction.maxTotal === "number" &&
      amount > sizedAction.maxTotal
    ) {
      setBetDraftError(`Maximum total is ${chips(sizedAction.maxTotal)}.`);
      return;
    }

    setBetDraftError(null);
    commitHumanAction(sizedAction.type, amount);
  }

  const startNextEngineHand = useCallback(async () => {
    if (!situation || mode !== "engine" || isSubmitting) return;
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    clearSuggestion();
    setIsSubmitting(true);
    setTableMessage("Dealing the next hand…");
    try {
      const transition = await requestTransition(
        demoApiUrl("/api/games/demo/new-hand", judgeRunRef.current),
        {
          method: "POST",
          body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
        },
      );
      const playback = await presentTransition(transition);
      if (playback === "completed") setTableMessage(null);
    } catch (error) {
      setTableMessage(
        error instanceof Error ? error.message : "The next hand could not start.",
      );
      try {
        await loadEngineSituation();
      } catch {
        // Keep the last known safe state visible if a refresh also fails.
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    clearSuggestion,
    isSubmitting,
    loadEngineSituation,
    mode,
    presentTransition,
    situation,
  ]);

  useEffect(() => {
    if (
      mode !== "engine" ||
      !situation?.handResult ||
      Boolean(situation.gameResult) ||
      isSubmitting ||
      autoNextHandVersionRef.current === situation.stateVersion
    ) {
      return;
    }

    nextHandTimerRef.current = setTimeout(() => {
      autoNextHandVersionRef.current = situation.stateVersion;
      void startNextEngineHand();
    }, 1_800);

    return () => {
      if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    };
  }, [isSubmitting, mode, situation, startNextEngineHand]);

  const restartEngineGame = useCallback(async () => {
    if (!situation?.gameResult || mode !== "engine" || isSubmitting) return;
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    clearSuggestion();
    setIsSubmitting(true);
    setTableMessage("Resetting the table…");

    try {
      const transition = await requestTransition(
        demoApiUrl("/api/games/demo/restart", judgeRunRef.current),
        {
          method: "POST",
          body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
        },
      );
      autoNextHandVersionRef.current = null;
      botAdvanceVersionRef.current = null;
      clearRecommendationReceipt();
      const playback = await presentTransition(transition);
      if (playback === "completed") setTableMessage(null);
    } catch (error) {
      setTableMessage(
        error instanceof Error ? error.message : "The table could not restart.",
      );
      try {
        await loadEngineSituation();
      } catch {
        // Keep the last known safe state visible if a refresh also fails.
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    clearRecommendationReceipt,
    clearSuggestion,
    isSubmitting,
    loadEngineSituation,
    mode,
    presentTransition,
    situation,
  ]);

  async function resetMockDemo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    cancelPlayback();
    clearSuggestion();

    if (mode === "mock") {
      clearRecommendationReceipt();
      setSituation(INITIAL_SITUATION);
      setTableMessage(null);
      return;
    }

  }

  async function retryLiveTable() {
    if (!isPracticeFallback || isRetryingLive) return;
    setIsRetryingLive(true);
    setTableMessage("Retrying the authoritative live table…");
    try {
      await loadEngineSituation();
    } catch (error) {
      setTableMessage(practiceFallbackMessage(error, true));
    } finally {
      setIsRetryingLive(false);
    }
  }

  if (!situation) {
    return (
      <div className="prototype">
        <PocketHeader supportState={supportState} situation={null} />
        <section className="game-shell is-loading" aria-busy="true">
          <div className="loading-stage">
            <div className="loading-table" aria-hidden="true">
              <span className="loading-seat loading-seat-top" />
              <span className="loading-seat loading-seat-right" />
              <span className="loading-seat loading-seat-bottom" />
              <span className="loading-seat loading-seat-left" />
              <span className="loading-board">
                <span />
                <span />
                <span />
              </span>
            </div>
            <div className="loading-copy">
              <h2>Preparing your seat</h2>
              <p>
                Shuffling the table and preparing your hand.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const visibleSuggestion =
    suggestion && isSuggestionCurrent(situation, suggestion)
      ? suggestion
      : null;
  const visibleReceipt =
    recommendationReceipt &&
    isRecommendationReceiptCurrent(situation, recommendationReceipt)
      ? recommendationReceipt
      : null;
  const turnTitle = isPlayingTransition
    ? situation.handResult
      ? "Settling the hand"
      : situation.isYourTurn
        ? "Your turn is next"
        : currentPlayer
          ? `${currentPlayer.displayName} is acting`
          : "Following the action"
    : isSubmitting
      ? currentPlayer && !situation.isYourTurn
        ? `${currentPlayer.displayName} is acting`
        : situation.handResult
          ? "Dealing the next hand"
          : "Playing your action"
    : situation.gameResult?.outcome === "won"
      ? "You won the table"
      : situation.gameResult?.outcome === "lost"
        ? "You’re out"
        : situation.handResult
      ? situation.yourStack > 0
        ? "Hand complete"
        : "Session complete"
      : situation.isYourTurn
        ? "Your turn"
        : currentPlayer
          ? `${currentPlayer.displayName} is acting`
          : "Table paused";
  const railRecommendationLabel = visibleSuggestion
    ? titleCase(describeAction(visibleSuggestion.action, visibleSuggestion.amount))
    : situation.isYourTurn && !situation.handResult && !situation.gameResult
      ? "Ready for your agent"
      : visibleReceipt
      ? visibleReceipt.outcome === "followed"
        ? "Recommendation followed"
        : "Recommendation overridden"
      : isPlayingTransition
        ? "Following table action"
        : supportState === "available"
          ? "Waiting for your turn"
          : supportState === "unavailable"
            ? "Copilot unavailable"
            : supportState === "error"
              ? "Copilot needs attention"
              : "Preparing copilot";

  return (
    <div className="prototype">
      <PocketHeader
        supportState={supportState}
        situation={situation}
        isPracticeFallback={isPracticeFallback}
      />

      <section className="game-layout game-shell">
        <div className="game-main">
          {decisionPresentation ? (
            <PokerTableSurface
              situation={situation}
              presentation={decisionPresentation}
              turnTitle={turnTitle}
            />
          ) : null}

          <HumanActionDock
            situation={situation}
            turnTitle={turnTitle}
            isSubmitting={isSubmitting}
            notice={tableMessage}
            betDraft={betDraft}
            betDraftError={betDraftError}
            betInputId="bet-amount"
            recommendation={visibleSuggestion}
            practiceFallback={
              isPracticeFallback
                ? {
                    isRetrying: isRetryingLive,
                    onRetry: () => void retryLiveTable(),
                  }
                : null
            }
            terminalAction={
              situation.gameResult
                ? {
                    label: "Play again",
                    onClick: () => {
                      if (mode === "mock") void resetMockDemo();
                      else void restartEngineGame();
                    },
                  }
                : situation.handResult
                  ? {
                      label: mode === "engine" ? "Next hand" : "Reset hand",
                      onClick: () => {
                        if (mode === "mock") void resetMockDemo();
                        else void startNextEngineHand();
                      },
                    }
                  : null
            }
            playback={
              isPlayingTransition
                ? {
                    status: playbackStatus,
                    onSkip: skipPlayback,
                  }
                : null
            }
            onBetDraftChange={(value) => {
              setBetDraft(value);
              setBetDraftError(null);
            }}
            onCommit={commitHumanAction}
            onSubmitSizedAction={submitSizedAction}
          />
        </div>

        <CompanionRail
          statusLabel={supportLabel(supportState, isPracticeFallback)}
          recommendationLabel={railRecommendationLabel}
        >
          <AgentSuggestionPanel
            key={
              visibleSuggestion
                ? `suggestion-${suggestionPresentationRevision}`
                : visibleReceipt
                  ? `receipt-${visibleReceipt.handNumber}-${visibleReceipt.sourceStateVersion}-${visibleReceipt.outcome}`
                  : `empty-${supportState}`
            }
            suggestion={visibleSuggestion}
            receipt={visibleReceipt}
            situation={situation}
            supportState={supportState}
            activity={activity}
            registrationError={registrationError}
            isSubmitting={isSubmitting || isPlayingTransition}
            isPlayingTransition={isPlayingTransition}
            onDismiss={() => {
              clearSuggestion();
              setTableMessage("Suggestion dismissed. Choose any legal action.");
            }}
          />
          <HandActionFeed situation={situation} receipt={visibleReceipt} />
        </CompanionRail>
      </section>

      {showDebug ? (
        <div className="debug-stack">
          <DebugPanel
            supportState={supportState}
            onFallbackSuggestion={handleSuggestion}
            situation={situation}
          />
          {registrationError ? (
            <p className="debug-detail">WebMCP detail: {registrationError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
