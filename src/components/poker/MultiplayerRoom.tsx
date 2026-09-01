"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { CompanionRail } from "@/components/poker/CompanionRail";
import { HandActionFeed } from "@/components/poker/HandActionFeed";
import { HumanActionDock } from "@/components/poker/HumanActionDock";
import { PokerTableSurface } from "@/components/poker/PokerTableSurface";
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
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  usePokerTools,
  type WebMCPSupportState,
} from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PlayingRoomSnapshot,
  PokerActionType,
  RoomOperationResult,
  RoomSnapshot,
} from "@/types/poker";

interface MultiplayerRoomProps {
  roomCode: string;
}

const START_REQUEST_TIMEOUT_MS = 7_000;
const START_RETRY_DELAY_MS = 450;

class RoomRequestError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "RoomRequestError";
    this.status = status;
    this.code = code;
  }
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== "object") return false;
  const room = value as Partial<RoomSnapshot>;
  return (
    (room.phase === "waiting" || room.phase === "active" || room.phase === "complete") &&
    typeof room.gameId === "string" &&
    typeof room.roomCode === "string" &&
    typeof room.revision === "number" &&
    Boolean(room.viewer) &&
    Array.isArray(room.seats)
  );
}

function isOperationResult(value: unknown): value is RoomOperationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<RoomOperationResult>;
  return isRoomSnapshot(result.room) && Boolean(result.operation);
}

async function responseError(response: Response, payload: unknown) {
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload.error as { code?: unknown; message?: unknown })
      : null;
  throw new RoomRequestError(
    typeof error?.message === "string"
      ? error.message
      : "Pocket could not complete that room request.",
    response.status,
    typeof error?.code === "string" ? error.code : null,
  );
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = response.status === 204 ? null : ((await response.json()) as unknown);
  if (!response.ok) await responseError(response, payload);
  return payload;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function webMCPLabel(value: string) {
  if (value === "available") return "WebMCP tools ready";
  if (value === "unavailable") return "WebMCP unavailable";
  if (value === "error") return "WebMCP needs attention";
  return "Preparing WebMCP";
}

export function MultiplayerRoom({ roomCode }: MultiplayerRoomProps) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("Connecting to the room…");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startNeedsRetry, setStartNeedsRetry] = useState(false);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "live" | "fallback"
  >("connecting");
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [staleSuggestion, setStaleSuggestion] =
    useState<AgentSuggestion | null>(null);
  const [receipt, setReceipt] = useState<RecommendationReceipt | null>(null);
  const [suggestionRevision, setSuggestionRevision] = useState(0);
  const [betDraft, setBetDraft] = useState("");
  const [betError, setBetError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [highestObservedRevision, setHighestObservedRevision] = useState(0);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const highestObservedRevisionRef = useRef(0);
  const advanceRevisionRef = useRef<number | null>(null);
  const suggestionRef = useRef<AgentSuggestion | null>(null);
  suggestionRef.current = suggestion;

  const situation = room && room.phase !== "waiting" ? room.situation : null;

  const clearSuggestion = useCallback((preserveAsStale = false) => {
    if (preserveAsStale && suggestionRef.current) {
      setStaleSuggestion(suggestionRef.current);
    } else if (!preserveAsStale) {
      setStaleSuggestion(null);
    }
    sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion(null);
  }, []);

  const clearReceipt = useCallback(() => {
    sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    setReceipt(null);
  }, []);

  const applyRoom = useCallback(
    (next: RoomSnapshot) => {
      const current = roomRef.current;
      if (current?.gameId === next.gameId && current.revision > next.revision) {
        return;
      }
      if (current?.gameId === next.gameId && next.revision > current.revision) {
        clearSuggestion(true);
      }
      highestObservedRevisionRef.current = Math.max(
        highestObservedRevisionRef.current,
        next.revision,
      );
      setHighestObservedRevision((current) => Math.max(current, next.revision));
      roomRef.current = next;
      setRoom(next);
      if (next.phase !== "waiting") setStartNeedsRetry(false);
      setNeedsJoin(false);
      setError(null);
    },
    [clearSuggestion],
  );

  const refreshRoom = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const pending = (async () => {
      try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const payload = await requestJson(`/api/rooms/${roomCode}/state`);
          if (!isRoomSnapshot(payload)) {
            throw new Error("Pocket returned an invalid room view.");
          }
          applyRoom(payload);
          if (
            (roomRef.current?.revision ?? 0) >=
            highestObservedRevisionRef.current
          ) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 75));
        }
        setRealtimeState("fallback");
      } catch (cause) {
        if (
          cause instanceof RoomRequestError &&
          (cause.status === 401 || cause.code === "NOT_ROOM_MEMBER")
        ) {
          setNeedsJoin(true);
          setMessage("Join this table from this browser session.");
          return;
        }
        setError(cause instanceof Error ? cause.message : "The room could not refresh.");
      }
    })();
    refreshPromiseRef.current = pending;
    try {
      await pending;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [applyRoom, roomCode]);

  useEffect(() => {
    void refreshRoom();
  }, [refreshRoom]);

  useEffect(() => {
    const gameId = room?.gameId;
    if (!gameId) return;
    let active = true;
    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]> | null = null;
    const client = createSupabaseBrowserClient();
    void (async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!data.session) throw new Error("The room session is unavailable.");
        await client.realtime.setAuth(data.session.access_token);
        if (!active) return;
        channel = client
          .channel(`game-revision:${gameId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "game_revisions",
              filter: `game_id=eq.${gameId}`,
            },
            (payload: { new: Record<string, unknown> }) => {
              const revision = Number((payload.new as { version?: unknown }).version);
              if (
                Number.isSafeInteger(revision) &&
                revision > (roomRef.current?.revision ?? 0)
              ) {
                highestObservedRevisionRef.current = Math.max(
                  highestObservedRevisionRef.current,
                  revision,
                );
                setHighestObservedRevision((current) =>
                  Math.max(current, revision),
                );
                clearSuggestion(true);
                void refreshRoom();
              }
            },
          )
          .subscribe((status: string) => {
            if (!active) return;
            if (status === "SUBSCRIBED") {
              setRealtimeState("live");
              void refreshRoom();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              setRealtimeState("fallback");
            }
          });
      } catch {
        if (active) setRealtimeState("fallback");
      }
    })();
    return () => {
      active = false;
      if (channel) void channel.unsubscribe();
    };
  }, [clearSuggestion, refreshRoom, room?.gameId]);

  useEffect(() => {
    if (!room) return;
    const interval = window.setInterval(
      () => void refreshRoom(),
      realtimeState === "live" ? 10_000 : 2_000,
    );
    const recover = () => void refreshRoom();
    const visible = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [realtimeState, refreshRoom, room]);

  useEffect(() => {
    if (room?.phase === "waiting") setInviteUrl(window.location.href);
  }, [room?.phase]);

  useEffect(() => {
    if (!situation) return;
    const restored = restoreStoredSuggestion(
      sessionStorage.getItem(AGENT_SUGGESTION_STORAGE_KEY),
      situation,
    );
    if (!restored) sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion((current) =>
      current && isSuggestionCurrent(situation, current) ? current : restored,
    );

    const restoredReceipt = restoreRecommendationReceipt(
      sessionStorage.getItem(RECOMMENDATION_RECEIPT_STORAGE_KEY),
      situation,
    );
    if (!restoredReceipt) {
      sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    }
    setReceipt((current) =>
      current && isRecommendationReceiptCurrent(situation, current)
        ? current
        : restoredReceipt,
    );
  }, [situation?.gameId, situation?.handNumber, situation?.stateVersion]);

  useEffect(() => {
    if (!situation || !suggestion) return;
    const serialized = serializeStoredSuggestion(situation, suggestion);
    if (serialized) sessionStorage.setItem(AGENT_SUGGESTION_STORAGE_KEY, serialized);
  }, [situation, suggestion]);

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation || !isSuggestionCurrent(situation, next)) return;
      clearReceipt();
      setStaleSuggestion(null);
      setSuggestion(next);
      setSuggestionRevision((value) => value + 1);
      setMessage("Your copilot placed a current recommendation at this seat.");
    },
    [clearReceipt, situation],
  );

  const { supportState, registrationError, activity } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
    roomPhase: room?.phase,
    viewerStatus: room?.viewer.status,
    observedRevision: highestObservedRevision,
    isRevisionCurrent: () =>
      highestObservedRevisionRef.current <= (roomRef.current?.revision ?? 0),
  });

  const sizedAction = useMemo(
    () =>
      situation?.legalActions.find(
        (action) => action.type === "bet" || action.type === "raise",
      ) ?? null,
    [situation],
  );

  useEffect(() => {
    setBetDraft(
      typeof sizedAction?.minTotal === "number"
        ? String(sizedAction.minTotal)
        : "",
    );
    setBetError(null);
  }, [situation?.stateVersion, sizedAction?.type, sizedAction?.minTotal]);

  async function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      if (!isRoomSnapshot(payload)) throw new Error("Pocket returned an invalid room view.");
      applyRoom(payload);
      setMessage("You have the second human seat. The creator can deal when ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not be joined.");
    } finally {
      setSubmitting(false);
    }
  }

  async function startRoom() {
    if (!room || room.phase !== "waiting") return;
    setSubmitting(true);
    setStartNeedsRetry(false);
    setError(null);
    setMessage("Locking the seats and dealing…");
    try {
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(
          () => controller.abort(),
          START_REQUEST_TIMEOUT_MS,
        );

        try {
          const current = roomRef.current;
          if (!current || current.phase !== "waiting") {
            setMessage("The table is live.");
            return;
          }
          const payload = await requestJson(`/api/rooms/${roomCode}/start`, {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({ expectedRevision: current.revision }),
          });
          if (!isOperationResult(payload)) {
            throw new Error("Pocket returned an invalid start result.");
          }
          applyRoom(payload.room);
          setMessage("The table is live.");
          return;
        } catch (cause) {
          lastError = cause;
          await refreshRoom();
          if (roomRef.current?.phase !== "waiting") {
            setMessage("The table is live.");
            return;
          }

          const recoverable =
            (cause instanceof DOMException && cause.name === "AbortError") ||
            (cause instanceof RoomRequestError &&
              (cause.status === 409 || cause.code === "ACTION_IN_PROGRESS"));
          if (attempt === 0 && recoverable) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, START_RETRY_DELAY_MS),
            );
            continue;
          }
          throw cause;
        } finally {
          window.clearTimeout(timeout);
        }
      }

      throw lastError ?? new Error("The room could not start.");
    } catch (cause) {
      setStartNeedsRetry(true);
      setError(
        cause instanceof DOMException && cause.name === "AbortError"
          ? "The start response timed out. Pocket refreshed the room; retry safely."
          : cause instanceof Error
            ? cause.message
            : "The room could not start.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function leaveRoom() {
    setSubmitting(true);
    try {
      await requestJson(`/api/rooms/${roomCode}/leave`, { method: "POST" });
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The seat could not be released.");
      setSubmitting(false);
    }
  }

  const commitAction = useCallback(
    async (action: PokerActionType, amount?: number) => {
      if (!room || room.phase === "waiting" || !situation?.isYourTurn || submitting) return;
      const actionId = crypto.randomUUID();
      const currentSuggestion =
        suggestion && isSuggestionCurrent(situation, suggestion) ? suggestion : null;
      const nextReceipt = currentSuggestion
        ? createRecommendationReceipt(situation, currentSuggestion, { action, amount })
        : null;
      const body = JSON.stringify({
        actionId,
        expectedRevision: room.revision,
        action,
        amount,
      });
      setSubmitting(true);
      setMessage(`Confirming ${describeAction(action, amount)}…`);

      try {
        let payload: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            payload = await requestJson(`/api/rooms/${roomCode}/action`, {
              method: "POST",
              body,
            });
            break;
          } catch (cause) {
            if (
              attempt === 0 &&
              (!(cause instanceof RoomRequestError) ||
                cause.code === "ACTION_IN_PROGRESS")
            ) {
              await new Promise((resolve) => window.setTimeout(resolve, 350));
              continue;
            }
            throw cause;
          }
        }
        if (!isOperationResult(payload)) throw new Error("Pocket returned an invalid action result.");
        clearSuggestion();
        if (nextReceipt) {
          sessionStorage.setItem(
            RECOMMENDATION_RECEIPT_STORAGE_KEY,
            serializeRecommendationReceipt(nextReceipt),
          );
          setReceipt(nextReceipt);
        }
        applyRoom(payload.room);
        const next = payload.room.phase === "waiting" ? null : payload.room.situation;
        setMessage(
          next?.handResult
            ? "The hand settled. The next hand will deal shortly."
            : "Action accepted. The table advanced to the next human.",
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The action was not accepted.");
        await refreshRoom();
      } finally {
        setSubmitting(false);
      }
    },
    [
      applyRoom,
      clearSuggestion,
      refreshRoom,
      room,
      roomCode,
      situation,
      submitting,
      suggestion,
    ],
  );

  function submitSizedAction() {
    if (!sizedAction) return;
    if (!/^\d+$/.test(betDraft)) {
      setBetError("Enter a whole-chip amount.");
      return;
    }
    const amount = Number(betDraft);
    if (
      !Number.isSafeInteger(amount) ||
      (typeof sizedAction.minTotal === "number" &&
        amount < sizedAction.minTotal) ||
      (typeof sizedAction.maxTotal === "number" &&
        amount > sizedAction.maxTotal)
    ) {
      setBetError(
        `Use a whole-chip final total from ${sizedAction.minTotal} to ${sizedAction.maxTotal}.`,
      );
      return;
    }
    void commitAction(sizedAction.type, amount);
  }

  useEffect(() => {
    if (
      !room ||
      room.phase !== "active" ||
      !room.situation.handResult ||
      advanceRevisionRef.current === room.revision
    ) {
      return;
    }
    const revision = room.revision;
    const timer = window.setTimeout(async () => {
      advanceRevisionRef.current = revision;
      try {
        const payload = await requestJson(`/api/rooms/${roomCode}/advance`, {
          method: "POST",
          body: JSON.stringify({ expectedRevision: revision }),
        });
        if (isOperationResult(payload)) applyRoom(payload.room);
      } catch {
        await refreshRoom();
      }
    }, 1_800);
    return () => window.clearTimeout(timer);
  }, [applyRoom, refreshRoom, room, roomCode]);

  async function restartRoom() {
    if (!room || room.phase !== "complete" || !room.viewer.isOwner) return;
    setSubmitting(true);
    clearSuggestion();
    try {
      const payload = await requestJson(`/api/rooms/${roomCode}/restart`, {
        method: "POST",
        body: JSON.stringify({
          restartId: crypto.randomUUID(),
          expectedRevision: room.revision,
        }),
      });
      if (!isOperationResult(payload)) throw new Error("Pocket returned an invalid restart result.");
      clearReceipt();
      applyRoom(payload.room);
      setMessage("A fresh tournament is live with the same seats.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not restart.");
      await refreshRoom();
    } finally {
      setSubmitting(false);
    }
  }

  if (needsJoin) {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={roomCode} status="Invite link" />
        <section className="waiting-room join-room">
          <div>
            <span className="multiplayer-kicker">Room {roomCode}</span>
            <h2>Take the second seat</h2>
            <p>This browser receives its own anonymous identity, private cards, and WebMCP tools.</p>
          </div>
          <form onSubmit={joinRoom}>
            <label htmlFor="join-display-name">Your table name</label>
            <input
              id="join-display-name"
              value={displayName}
              maxLength={24}
              required
              autoComplete="nickname"
              placeholder="Alex"
              disabled={submitting}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? "Taking seat…" : "Sit down"}
            </button>
            {error ? <span className="field-error" role="alert">{error}</span> : null}
          </form>
        </section>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={roomCode} status="Connecting" />
        <section className="game-shell is-loading" aria-busy="true">
          <div className="loading-stage">
            <div className="loading-copy">
              <h2>Finding your seat</h2>
              <p>{error ?? message}</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (room.phase === "waiting") {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={room.roomCode} status={realtimeState === "live" ? "Room live" : "Room reconnecting"} />
        <section className="waiting-room">
          <div className="waiting-copy">
            <span className="multiplayer-kicker">Waiting room</span>
            <h2>{room.viewer.isOwner ? "Deal when your table is ready" : "You have the second seat"}</h2>
            <p>{room.viewer.isOwner ? "Share the room link or start now; bots fill every open seat." : "The creator will start the table. Your seat stays bound to this browser session."}</p>
          </div>
          <div className="waiting-seats">
            {room.seats.map((seat) => (
              <div className="waiting-seat" key={seat.playerId} data-human={!seat.isBot}>
                <span>Seat {seat.seat + 1}</span>
                <strong>{seat.isYou ? "You" : seat.displayName}</strong>
                <small>{seat.isBot ? "Bot placeholder" : "Human seat"}</small>
              </div>
            ))}
          </div>
          <div className="waiting-actions">
            <label>
              Invite link
              <span>{inviteUrl}</span>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              Copy link
            </button>
            {room.viewer.isOwner ? (
              <button className="primary-button" disabled={submitting} onClick={() => void startRoom()}>
                {submitting
                  ? "Dealing…"
                  : startNeedsRetry
                    ? "Retry start"
                    : "Start table"}
              </button>
            ) : (
              <button className="secondary-button" disabled={submitting} onClick={() => void leaveRoom()}>
                Leave waiting room
              </button>
            )}
          </div>
          <p className="room-message" aria-live="polite">{error ?? message}</p>
        </section>
      </div>
    );
  }

  const playing = room as PlayingRoomSnapshot;
  const currentPlayer = playing.situation.players.find(
    (player) => player.id === playing.situation.currentActorId,
  );
  const visibleSuggestion =
    suggestion && isSuggestionCurrent(playing.situation, suggestion) ? suggestion : null;
  const visibleReceipt =
    receipt && isRecommendationReceiptCurrent(playing.situation, receipt) ? receipt : null;
  const isSpectating = playing.viewer.status === "eliminated";
  const turnTitle =
    playing.phase === "complete"
      ? playing.result?.winnerPlayerId === playing.viewer.playerId
        ? "You won the table"
        : "Table complete"
      : isSpectating
        ? "You’re spectating"
        : playing.situation.isYourTurn
          ? "Your turn"
          : currentPlayer
            ? `${currentPlayer.displayName} is acting`
            : "Hand complete";
  const decisionPresentation = createDecisionPresentation(
    playing.situation,
    {
      isSpectating,
      isComplete: playing.phase === "complete",
    },
  );
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
    <div className="prototype room-prototype">
      <RoomHeader
        roomCode={playing.roomCode}
        supportState={supportState}
        realtimeState={realtimeState}
        situation={playing.situation}
      />
      <section className="game-layout game-shell">
        <div className="game-main">
          <PokerTableSurface
            situation={playing.situation}
            presentation={decisionPresentation}
            turnTitle={turnTitle}
          />
          <HumanActionDock
            situation={playing.situation}
            turnTitle={turnTitle}
            isSubmitting={submitting}
            notice={error ?? (submitting ? message : null)}
            betDraft={betDraft}
            betDraftError={betError}
            betInputId="room-bet-amount"
            isSpectating={isSpectating}
            terminalAction={
              playing.phase === "complete" && playing.viewer.isOwner
                ? { label: "Play again", onClick: () => void restartRoom() }
                : null
            }
            onBetDraftChange={(value) => {
              setBetDraft(value);
              setBetError(null);
            }}
            onCommit={(action, amount) => void commitAction(action, amount)}
            onSubmitSizedAction={submitSizedAction}
            onMax={(amount) => {
              setBetDraft(String(amount));
              setBetError(null);
            }}
          />
        </div>

        <CompanionRail
          statusLabel={webMCPLabel(supportState)}
          recommendationLabel={railRecommendationLabel}
        >
          <AgentSuggestionPanel
            key={
              visibleSuggestion
                ? `suggestion-${suggestionRevision}`
                : visibleReceipt
                  ? `receipt-${visibleReceipt.sourceStateVersion}`
                  : staleSuggestion
                    ? `stale-${staleSuggestion.stateVersion}`
                    : `empty-${supportState}-${playing.viewer.status}`
            }
            suggestion={visibleSuggestion}
            staleSuggestion={staleSuggestion}
            receipt={visibleReceipt}
            situation={playing.situation}
            supportState={supportState}
            activity={activity}
            registrationError={registrationError}
            isSubmitting={submitting}
            isSpectating={isSpectating}
            onUse={(next) => void commitAction(next.action, next.amount)}
            onDismiss={() => {
              clearSuggestion();
              setMessage("Suggestion dismissed. Choose any legal action.");
            }}
          />
          <HandActionFeed
            situation={playing.situation}
            receipt={visibleReceipt}
            privacyLabel={isSpectating ? "Spectator-safe" : "Seat-safe"}
          />
        </CompanionRail>
      </section>
      {registrationError ? <p className="debug-detail">WebMCP detail: {registrationError}</p> : null}
    </div>
  );
}

function RoomHeader({
  roomCode,
  status,
  supportState,
  realtimeState,
  situation,
}: {
  roomCode: string;
  status?: string;
  supportState?: WebMCPSupportState;
  realtimeState?: "connecting" | "live" | "fallback";
  situation?: PlayingRoomSnapshot["situation"];
}) {
  const supportLabel = status ?? webMCPLabel(supportState ?? "checking");
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
        <span
          className="status-pill"
          data-state={supportState ?? "checking"}
        >
          <span className="status-dot" />
          {supportLabel}
        </span>
        <span className="header-game-meta">
          {situation ? (
            <>
              <span>Hand {situation.handNumber}</span>
              <span aria-hidden="true">·</span>
              <span>Blinds {situation.smallBlind}/{situation.bigBlind}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>Room {roomCode}</span>
          {realtimeState ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{realtimeState === "live" ? "Live" : "Recovering"}</span>
            </>
          ) : null}
        </span>
      </div>
    </header>
  );
}
