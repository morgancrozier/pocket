"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { DebugPanel } from "@/components/poker/DebugPanel";
import { PlayerSeat } from "@/components/poker/PlayerSeat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import {
  advanceMockStreet,
  appendEvent,
  describeAction,
  INITIAL_SITUATION,
  isDebugPanelRequested,
  isMockFallbackRequested,
  nextMockBoard,
  nextMockLegalActions,
} from "@/lib/poker/mock-state";
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

function actionLabel(action: PokerSituation["legalActions"][number]) {
  const label = titleCase(action.type);

  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }

  if ((action.type === "bet" || action.type === "raise") && action.min) {
    return label;
  }

  return label;
}

function supportLabel(supportState: WebMCPSupportState): string {
  if (supportState === "available") return "WebMCP ready";
  if (supportState === "unavailable") return "WebMCP unavailable";
  if (supportState === "error") return "WebMCP needs attention";
  return "Preparing WebMCP";
}

function PocketHeader({
  supportState,
  situation,
}: {
  supportState: WebMCPSupportState;
  situation: PokerSituation | null;
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
          {supportLabel(supportState)}
        </span>
        <span className="trust-line">
          {situation
            ? `Play money · Blinds ${situation.smallBlind}/${situation.bigBlind} · Hand ${situation.handNumber}`
            : "Your agent advises. You play."}
        </span>
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
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [recommendationReceipt, setRecommendationReceipt] =
    useState<RecommendationReceipt | null>(null);
  const [suggestionPresentationRevision, setSuggestionPresentationRevision] =
    useState(0);
  const [tableMessage, setTableMessage] = useState(
    "Preparing your first hand…",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [betDraft, setBetDraft] = useState("");
  const [betDraftError, setBetDraftError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextHandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextHandVersionRef = useRef<number | null>(null);

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

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation) return;
      if (!isSuggestionCurrent(situation, next)) return;
      clearRecommendationReceipt();
      setSuggestion(next);
      setSuggestionPresentationRevision((current) => current + 1);
    },
    [clearRecommendationReceipt, situation],
  );

  const { supportState, registrationError } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
  });

  const loadEngineSituation = useCallback(async () => {
    await ensureSupabaseBrowserIdentity();
    const next = await requestSituation("/api/games/demo/state");
    setSituation(next);
    setMode("engine");
    setTableMessage(
      next.gameResult
        ? resultMessage(next)
        : next.isYourTurn
          ? "The bots posted and acted. Your turn."
          : resultMessage(next),
    );
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const forceMock = isMockFallbackRequested(window.location.search);
    setShowDebug(isDebugPanelRequested(window.location.search));

    if (forceMock) {
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setTableMessage("Alex raised to 44. Your turn.");
      return () => {
        active = false;
      };
    }

    void loadEngineSituation().catch(() => {
      if (!active) return;
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setTableMessage(
        "Pocket could not reach the live table, so this practice hand remains available.",
      );
    });

    return () => {
      active = false;
    };
  }, [loadEngineSituation]);

  useEffect(() => {
    if (!situation) return;

    const restored = restoreStoredSuggestion(
      sessionStorage.getItem(AGENT_SUGGESTION_STORAGE_KEY),
      situation,
    );
    if (!restored) {
      sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    }

    setSuggestion((current) =>
      current && isSuggestionCurrent(situation, current) ? current : restored,
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
  const remainingPlayerCount = useMemo(
    () => situation?.players.filter((player) => player.stack > 0).length ?? 0,
    [situation],
  );
  const receiptActionSequence = useMemo(() => {
    if (!situation || !recommendationReceipt) return null;

    for (let index = situation.recentActions.length - 1; index >= 0; index -= 1) {
      const event = situation.recentActions[index];
      if (
        event.playerId !== situation.yourPlayerId ||
        event.action !== recommendationReceipt.humanChoice.action
      ) {
        continue;
      }

      if (
        (event.action === "bet" || event.action === "raise") &&
        event.amount !== recommendationReceipt.humanChoice.amount
      ) {
        continue;
      }

      return event.sequence;
    }

    return null;
  }, [recommendationReceipt, situation]);

  useEffect(() => {
    setBetDraft(
      typeof sizedAction?.min === "number" ? String(sizedAction.min) : "",
    );
    setBetDraftError(null);
  }, [
    situation?.gameId,
    situation?.handNumber,
    situation?.stateVersion,
    sizedAction?.type,
    sizedAction?.min,
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
            recentActions: nextActions,
          };
        });

        setTableMessage(
          action === "fold"
            ? "This practice hand ends here."
            : receipt
              ? "Alex responded. Your copilot decision remains recorded for this hand."
              : "Alex responded. The table changed, so any old recommendation expired.",
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
        const next = await requestSituation("/api/games/demo/action", {
          method: "POST",
          body: JSON.stringify({
            action,
            amount,
            expectedStateVersion: situation.stateVersion,
          }),
        });
        clearSuggestion();
        acceptRecommendationReceipt(receipt);
        setSituation(next);
        setTableMessage(
          next.handResult && !next.gameResult
            ? `${resultMessage(next)} The next hand starts shortly.`
            : resultMessage(next),
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
    if (typeof sizedAction.min === "number" && amount < sizedAction.min) {
      setBetDraftError(`Minimum is ${sizedAction.min} chips.`);
      return;
    }
    if (typeof sizedAction.max === "number" && amount > sizedAction.max) {
      setBetDraftError(`Maximum is ${sizedAction.max} chips.`);
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
      const next = await requestSituation("/api/games/demo/new-hand", {
        method: "POST",
        body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
      });
      setSituation(next);
      setTableMessage("A new hand is live. Your turn when the bots finish.");
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
      const next = await requestSituation("/api/games/demo/restart", {
        method: "POST",
        body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
      });
      autoNextHandVersionRef.current = null;
      clearRecommendationReceipt();
      setSituation(next);
      setTableMessage("A new tournament is live. Four players, 40 chips each.");
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
      setTableMessage("Alex raised to 44. Your turn.");
      return;
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
  const decisionContext = situation.gameResult
    ? `${remainingPlayerCount} player${remainingPlayerCount === 1 ? "" : "s"} remaining`
    : situation.isYourTurn
      ? situation.toCall > 0
        ? `${situation.toCall} to call`
        : "Check available"
      : situation.handResult
        ? "Settled"
        : "Waiting";

  return (
    <div className="prototype">
      <PocketHeader supportState={supportState} situation={situation} />

      <section className="game-shell">
        <div className="table-stage">
          <div className="table-stage-header">
            <div className="hand-context">
              <span>Hand {situation.handNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{titleCase(situation.street)}</span>
              <span aria-hidden="true">·</span>
              <span>Blinds {situation.smallBlind}/{situation.bigBlind}</span>
              <span aria-hidden="true">·</span>
              <span>{remainingPlayerCount} remaining</span>
            </div>
            <span
              className={`turn-status ${situation.isYourTurn && !isSubmitting ? "is-active" : ""}`}
            >
              {turnTitle}
            </span>
          </div>

          <div className="poker-table">
            <div className="table-center">
              <span className="pot-label">
                Pot <strong>{situation.pot}</strong>
              </span>
              <div className="card-row community-cards">
                {situation.board.map((card) => (
                  <PlayingCard key={card} card={card} />
                ))}
                {Array.from({
                  length: Math.max(0, 5 - situation.board.length),
                }).map((_, index) => (
                  <span
                    key={`empty-${index}`}
                    className="playing-card is-hidden is-empty-slot"
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>

            {situation.players.map((player) => (
              <PlayerSeat
                key={player.id}
                player={player}
                isCurrent={player.id === situation.currentActorId}
                isDealer={player.seat === situation.dealerSeat}
                localCards={
                  player.id === situation.yourPlayerId
                    ? situation.yourCards
                    : undefined
                }
              />
            ))}
          </div>
        </div>

        <div className="decision-dock">
          <section
            className="action-zone"
            aria-labelledby="decision-title"
            aria-busy={isSubmitting}
          >
            <div className="decision-heading">
              <div>
                <h2 id="decision-title">{turnTitle}</h2>
                <p aria-live="polite">{tableMessage}</p>
              </div>
              <span className="decision-context">{decisionContext}</span>
            </div>
            <div className="action-buttons">
              {situation.legalActions
                .filter(
                  (action) => action.type !== "bet" && action.type !== "raise",
                )
                .map((action) => (
                <button
                  key={action.type}
                  className={`action-button action-${action.type}`}
                  disabled={!situation.isYourTurn || isSubmitting}
                  onClick={() => commitHumanAction(action.type, action.amount)}
                >
                  {actionLabel(action)}
                </button>
                ))}
              {sizedAction ? (
                <form
                  className="sized-action"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSizedAction();
                  }}
                >
                  <label htmlFor="bet-amount">
                    {titleCase(sizedAction.type)} amount
                    <span>
                      Min {sizedAction.min} · Max {sizedAction.max}
                    </span>
                  </label>
                  <div className="sized-action-entry">
                    <input
                      id="bet-amount"
                      name="betAmount"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={betDraft}
                      disabled={!situation.isYourTurn || isSubmitting}
                      aria-invalid={Boolean(betDraftError)}
                      aria-describedby={
                        betDraftError ? "bet-amount-error" : "bet-amount-range"
                      }
                      onChange={(event) => {
                        setBetDraft(event.target.value);
                        setBetDraftError(null);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button max-button"
                      disabled={
                        !situation.isYourTurn ||
                        isSubmitting ||
                        typeof sizedAction.max !== "number"
                      }
                      onClick={() => {
                        if (typeof sizedAction.max === "number") {
                          setBetDraft(String(sizedAction.max));
                          setBetDraftError(null);
                        }
                      }}
                    >
                      Max
                    </button>
                    <button
                      type="submit"
                      className={`action-button action-${sizedAction.type}`}
                      disabled={!situation.isYourTurn || isSubmitting}
                    >
                      {titleCase(sizedAction.type)}
                    </button>
                  </div>
                  <span id="bet-amount-range" className="sr-only">
                    Legal range {sizedAction.min} to {sizedAction.max} chips.
                  </span>
                  {betDraftError ? (
                    <span
                      id="bet-amount-error"
                      className="field-error"
                      role="alert"
                    >
                      {betDraftError}
                    </span>
                  ) : null}
                </form>
              ) : null}
              {situation.gameResult ? (
                <button
                  className="action-button action-restart"
                  disabled={isSubmitting}
                  onClick={() => {
                    if (mode === "mock") {
                      void resetMockDemo();
                    } else {
                      void restartEngineGame();
                    }
                  }}
                >
                  Play again
                </button>
              ) : situation.legalActions.length === 0 ? (
                <button
                  className="action-button action-next"
                  disabled={isSubmitting}
                  onClick={() =>
                    mode === "mock"
                      ? void resetMockDemo()
                      : void startNextEngineHand()
                  }
                >
                  {mode === "engine" ? "Next hand" : "Reset hand"}
                </button>
              ) : null}
            </div>
          </section>

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
            isSubmitting={isSubmitting}
            onUse={useSuggestion}
            onDismiss={() => {
              clearSuggestion();
              setTableMessage("Suggestion dismissed. Choose any legal action.");
            }}
          />
        </div>
      </section>

      <section className="history-card" aria-labelledby="history-title">
        <div className="card-heading">
          <h2 id="history-title">Hand activity</h2>
          <span>
            Hand {situation.handNumber} · {titleCase(situation.street)}
          </span>
        </div>
        {situation.recentActions.length > 0 ? (
          <ol className="history-list">
            {situation.recentActions.slice(-6).map((event) => (
              <li className="history-item" key={event.sequence}>
                <span className="history-street">{event.street}</span>
                <strong>
                  {event.playerId === situation.yourPlayerId
                    ? "You"
                    : event.playerName}
                </strong>
                <span className="history-action">
                  <span>{describeAction(event.action, event.amount)}</span>
                  {event.sequence === receiptActionSequence && visibleReceipt ? (
                    <span
                      className={`history-recommendation history-recommendation-${visibleReceipt.outcome}`}
                    >
                      {visibleReceipt.outcome}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="history-empty">The first action will appear here.</p>
        )}
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
