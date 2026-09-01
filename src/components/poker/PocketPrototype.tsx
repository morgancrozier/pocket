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
import { ensureSupabaseBrowserIdentity } from "@/lib/supabase/client";
import {
  usePokerTools,
  type WebMCPSupportState,
} from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

type DemoMode = "engine" | "loading" | "mock";

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

function demoApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const current = new URLSearchParams(window.location.search);
  if (current.get("demo") === "judge") {
    const query = new URLSearchParams({ demo: "judge" });
    const run = current.get("run");
    if (run) query.set("run", run);
    return `${path}?${query.toString()}`;
  }
  return path;
}

function ensureJudgeDemoRun(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("demo") !== "judge") return;
  if (url.searchParams.get("run")) return;
  url.searchParams.set("run", crypto.randomUUID());
  window.history.replaceState(window.history.state, "", url);
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
            <span>Blinds {situation.smallBlind}/{situation.bigBlind}</span>
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
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "The table could not complete that request.";
    throw new Error(message);
  }

  if (!isPokerSituation(payload)) {
    throw new Error("Pocket could not refresh this hand.");
  }

  return payload;
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
    .map((winner) => `${winner.playerName} won ${winner.amount}`)
    .join(" · ");
  return winners || "The hand settled.";
}

function actionPendingMessage(
  action: PokerActionType,
  amount: number | undefined,
  receipt: RecommendationReceipt | null,
): string {
  const humanChoice = describeAction(action, amount);
  if (!receipt) return `You chose ${humanChoice}. The bots are responding…`;
  if (receipt.outcome === "followed") {
    return `You followed your copilot: ${humanChoice}. The bots are responding…`;
  }

  return `You chose ${humanChoice} instead of ${describeAction(receipt.recommendation.action, receipt.recommendation.amount)}. The bots are responding…`;
}

export function PocketPrototype() {
  const [situation, setSituation] = useState<PokerSituation | null>(null);
  const [mode, setMode] = useState<DemoMode>("loading");
  const [isPracticeFallback, setIsPracticeFallback] = useState(false);
  const [isRetryingLive, setIsRetryingLive] = useState(false);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [staleSuggestion, setStaleSuggestion] =
    useState<AgentSuggestion | null>(null);
  const [recommendationReceipt, setRecommendationReceipt] =
    useState<RecommendationReceipt | null>(null);
  const [suggestionPresentationRevision, setSuggestionPresentationRevision] =
    useState(0);
  const [tableMessage, setTableMessage] = useState<string | null>(
    "Preparing your first hand…",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [betDraft, setBetDraft] = useState("");
  const [betDraftError, setBetDraftError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextHandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextHandVersionRef = useRef<number | null>(null);
  const suggestionRef = useRef<AgentSuggestion | null>(null);
  suggestionRef.current = suggestion;

  const clearSuggestion = useCallback((preserveAsStale = false) => {
    if (preserveAsStale && suggestionRef.current) {
      setStaleSuggestion(suggestionRef.current);
    } else if (!preserveAsStale) {
      setStaleSuggestion(null);
    }
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

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation) return;
      if (!isSuggestionCurrent(situation, next)) return;
      clearRecommendationReceipt();
      setStaleSuggestion(null);
      setSuggestion(next);
      setSuggestionPresentationRevision((current) => current + 1);
    },
    [clearRecommendationReceipt, situation],
  );

  const { supportState, registrationError, activity } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
  });

  const loadEngineSituation = useCallback(async () => {
    await ensureSupabaseBrowserIdentity();
    const next = await requestSituation(demoApiUrl("/api/games/demo/state"));
    setSituation(next);
    setMode("engine");
    setIsPracticeFallback(false);
    setTableMessage(
      next.gameResult || next.handResult ? resultMessage(next) : null,
    );
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    ensureJudgeDemoRun();
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

    void loadEngineSituation().catch(() => {
      if (!active) return;
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setIsPracticeFallback(true);
      setTableMessage(
        "The authoritative live table is unavailable. This is a practice hand only.",
      );
    });

    return () => {
      active = false;
    };
  }, [loadEngineSituation]);

  useEffect(() => {
    if (!situation) return;

    const previous = suggestionRef.current;
    if (previous && !isSuggestionCurrent(situation, previous)) {
      setStaleSuggestion(previous);
    }

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
      setTableMessage(actionPendingMessage(action, amount, receipt));

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
      setTableMessage(actionPendingMessage(action, amount, receipt));

      try {
        const next = await requestSituation(
          demoApiUrl("/api/games/demo/action"),
          {
          method: "POST",
          body: JSON.stringify({
            action,
            amount,
            expectedStateVersion: situation.stateVersion,
          }),
          },
        );
        clearSuggestion();
        acceptRecommendationReceipt(receipt);
        setSituation(next);
        setTableMessage(
          next.handResult
            ? next.gameResult
              ? resultMessage(next)
              : `${resultMessage(next)} The next hand starts shortly.`
            : null,
        );
      } catch (error) {
        setTableMessage(
          error instanceof Error ? error.message : "The action was rejected.",
        );
        try {
          await loadEngineSituation();
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
      setBetDraftError(`Minimum total is ${sizedAction.minTotal} chips.`);
      return;
    }
    if (
      typeof sizedAction.maxTotal === "number" &&
      amount > sizedAction.maxTotal
    ) {
      setBetDraftError(`Maximum total is ${sizedAction.maxTotal} chips.`);
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
      const next = await requestSituation(demoApiUrl("/api/games/demo/new-hand"), {
        method: "POST",
        body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
      });
      setSituation(next);
      setTableMessage(null);
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
  }, [clearSuggestion, isSubmitting, loadEngineSituation, mode, situation]);

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
      const next = await requestSituation(demoApiUrl("/api/games/demo/restart"), {
        method: "POST",
        body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
      });
      autoNextHandVersionRef.current = null;
      clearRecommendationReceipt();
      setSituation(next);
      setTableMessage(null);
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
    situation,
  ]);

  function useSuggestion(next: AgentSuggestion) {
    if (!situation || !isSuggestionCurrent(situation, next)) {
      clearSuggestion();
      setTableMessage("Suggestion expired — the table changed.");
      return;
    }
    commitHumanAction(next.action, next.amount);
  }

  async function resetMockDemo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
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
    } catch {
      setTableMessage(
        "The authoritative live table is still unavailable. This remains a practice hand only.",
      );
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
  const turnTitle = isSubmitting
    ? "Playing your action"
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
    : visibleReceipt
      ? visibleReceipt.outcome === "followed"
        ? "Recommendation followed"
        : "Recommendation overridden"
      : staleSuggestion
        ? "Recommendation expired"
        : supportState === "available"
          ? "Awaiting a recommendation"
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
            onBetDraftChange={(value) => {
              setBetDraft(value);
              setBetDraftError(null);
            }}
            onCommit={commitHumanAction}
            onSubmitSizedAction={submitSizedAction}
            onMax={(amount) => {
              setBetDraft(String(amount));
              setBetDraftError(null);
            }}
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
                  : staleSuggestion
                    ? `stale-${staleSuggestion.handNumber}-${staleSuggestion.stateVersion}`
                    : `empty-${supportState}`
            }
            suggestion={visibleSuggestion}
            staleSuggestion={staleSuggestion}
            receipt={visibleReceipt}
            situation={situation}
            supportState={supportState}
            activity={activity}
            registrationError={registrationError}
            isSubmitting={isSubmitting}
            onUse={useSuggestion}
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
