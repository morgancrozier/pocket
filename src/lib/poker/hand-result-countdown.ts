export const FOLD_RESULT_HOLD_MS = 4_000;
export const SHOWDOWN_RESULT_HOLD_MS = 7_000;

export function handResultHoldDuration(
  reason: "fold" | "showdown",
): number {
  return reason === "showdown"
    ? SHOWDOWN_RESULT_HOLD_MS
    : FOLD_RESULT_HOLD_MS;
}

interface HandResultCountdownOptions {
  countdownKey: string;
  durationMs: number;
  onTick: (remainingMs: number) => void;
  onElapsed: () => void;
}

export class HandResultCountdown {
  private interval: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private finished = false;
  private completedKey: string | null = null;

  start({
    countdownKey,
    durationMs,
    onTick,
    onElapsed,
  }: HandResultCountdownOptions): void {
    this.cancel();
    if (this.completedKey === countdownKey) {
      onTick(0);
      return;
    }
    this.startedAt = Date.now();
    this.finished = false;
    onTick(durationMs);

    this.interval = setInterval(() => {
      onTick(Math.max(0, durationMs - (Date.now() - this.startedAt)));
    }, 1_000);
    this.timeout = setTimeout(() => {
      if (this.finished) return;
      this.finished = true;
      this.completedKey = countdownKey;
      this.clearTimers();
      onTick(0);
      onElapsed();
    }, durationMs);
  }

  cancel(): void {
    this.finished = true;
    this.clearTimers();
  }

  complete(countdownKey: string): void {
    this.completedKey = countdownKey;
    this.cancel();
  }

  private clearTimers(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.timeout) clearTimeout(this.timeout);
    this.interval = null;
    this.timeout = null;
  }
}
