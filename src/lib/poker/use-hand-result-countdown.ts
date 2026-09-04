"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HandResultCountdown } from "@/lib/poker/hand-result-countdown";

interface UseHandResultCountdownInput {
  active: boolean;
  countdownKey: string;
  durationMs: number;
  onElapsed: () => void;
}

export function useHandResultCountdown({
  active,
  countdownKey,
  durationMs,
  onElapsed,
}: UseHandResultCountdownInput) {
  const countdownRef = useRef<HandResultCountdown | null>(null);
  const onElapsedRef = useRef(onElapsed);
  const [remainingMs, setRemainingMs] = useState(active ? durationMs : 0);
  onElapsedRef.current = onElapsed;

  if (!countdownRef.current) {
    countdownRef.current = new HandResultCountdown();
  }

  useEffect(() => {
    const countdown = countdownRef.current!;
    if (!active) {
      countdown.cancel();
      return;
    }

    countdown.start({
      countdownKey,
      durationMs,
      onTick: setRemainingMs,
      onElapsed: () => onElapsedRef.current(),
    });
    return () => countdown.cancel();
  }, [active, countdownKey, durationMs]);

  const cancel = useCallback(() => {
    countdownRef.current?.complete(countdownKey);
    setRemainingMs(0);
  }, [countdownKey]);

  return {
    remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1_000)),
    progress: durationMs > 0 ? Math.max(0, remainingMs / durationMs) : 0,
    cancel,
  };
}
