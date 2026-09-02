"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  AuthoritativeBotScheduler,
  botPacingDelay,
} from "@/lib/poker/bot-pacing";
import type { PokerSituation } from "@/types/poker";

interface UseBotPacingInput {
  situation: PokerSituation | null;
  enabled: boolean;
  advance: (situation: PokerSituation, signal: AbortSignal) => Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
}

export function useBotPacing({
  situation,
  enabled,
  advance,
  onError,
}: UseBotPacingInput) {
  const schedulerRef = useRef<AuthoritativeBotScheduler | null>(null);
  const previousRef = useRef<PokerSituation | null>(null);
  const advanceRef = useRef(advance);
  const errorRef = useRef(onError);
  if (!schedulerRef.current) {
    schedulerRef.current = new AuthoritativeBotScheduler();
  }
  advanceRef.current = advance;
  errorRef.current = onError;

  const currentBot =
    situation?.players.find(
      (player) => player.id === situation.currentActorId && player.isBot,
    ) ?? null;
  const isBotTurn = Boolean(
    enabled &&
      situation &&
      currentBot &&
      !situation.handResult &&
      !situation.gameResult,
  );

  useEffect(() => {
    const scheduler = schedulerRef.current!;
    const previous = previousRef.current;
    previousRef.current = situation;

    if (!isBotTurn || !situation || !currentBot) {
      scheduler.stopAtHuman();
      return;
    }

    scheduler.schedule({
      sequenceKey: `${situation.gameId}:${situation.handNumber}`,
      stateKey: `${situation.gameId}:${situation.handNumber}:${situation.stateVersion}:${currentBot.id}`,
      delayMs: botPacingDelay(previous, situation),
      run: (signal) => advanceRef.current(situation, signal),
      onError: (error) => errorRef.current(error),
    });
  }, [
    currentBot?.id,
    enabled,
    isBotTurn,
    situation?.gameId,
    situation?.gameResult,
    situation?.handNumber,
    situation?.handResult,
    situation?.stateVersion,
  ]);

  useEffect(
    () => () => {
      schedulerRef.current?.cancel();
    },
    [],
  );

  const skipToHuman = useCallback(() => {
    schedulerRef.current?.skipToHuman();
  }, []);

  const cancelPacing = useCallback(() => {
    schedulerRef.current?.cancel();
    previousRef.current = null;
  }, []);

  return {
    currentBot,
    isBotTurn,
    skipToHuman,
    cancelPacing,
  };
}
