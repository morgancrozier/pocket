import type { PokerSituation } from "@/types/poker";

export const BOT_ACTION_DELAY_MS = 4_000;
export const BOARD_REVEAL_DELAY_MS = 2_000;

export function botPacingDelay(
  previous: PokerSituation | null,
  current: PokerSituation,
): number {
  if (!previous || previous.gameId !== current.gameId) {
    return BOT_ACTION_DELAY_MS;
  }

  // Preserve the full first beat after a human decision so a copilot receipt
  // has time to register, even when that decision also closes the street.
  if (previous.isYourTurn && !current.isYourTurn) {
    return BOT_ACTION_DELAY_MS;
  }

  if (
    previous.handNumber !== current.handNumber ||
    previous.street !== current.street ||
    current.board.length > previous.board.length
  ) {
    return BOARD_REVEAL_DELAY_MS;
  }

  return BOT_ACTION_DELAY_MS;
}

interface ScheduledBotStep {
  sequenceKey: string;
  stateKey: string;
  delayMs: number;
  run: (signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

interface PendingBotStep {
  stateKey: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  execute: () => void;
}

export class AuthoritativeBotScheduler {
  private pending: PendingBotStep | null = null;
  private sequenceKey: string | null = null;
  private skipRemaining = false;

  schedule(step: ScheduledBotStep): void {
    if (this.sequenceKey !== step.sequenceKey) {
      this.cancelPending();
      this.sequenceKey = step.sequenceKey;
      this.skipRemaining = false;
    }

    if (this.pending?.stateKey === step.stateKey) return;
    this.cancelPending();

    const controller = new AbortController();
    const pending: PendingBotStep = {
      stateKey: step.stateKey,
      controller,
      timer: null,
      inFlight: false,
      execute: () => undefined,
    };

    const execute = () => {
      if (controller.signal.aborted || pending.inFlight) return;
      pending.inFlight = true;
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = null;
      }

      void step
        .run(controller.signal)
        .catch(async (error: unknown) => {
          if (!controller.signal.aborted) await step.onError?.(error);
        })
        .finally(() => {
          pending.inFlight = false;
          if (this.pending === pending) this.pending = null;
        });
    };
    pending.execute = execute;
    pending.timer = setTimeout(
      execute,
      this.skipRemaining ? 0 : step.delayMs,
    );
    this.pending = pending;
  }

  skipToHuman(): void {
    this.skipRemaining = true;
    this.pending?.execute();
  }

  stopAtHuman(): void {
    this.cancelPending();
    this.sequenceKey = null;
    this.skipRemaining = false;
  }

  cancel(): void {
    this.stopAtHuman();
  }

  private cancelPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.controller.abort();
  }
}
