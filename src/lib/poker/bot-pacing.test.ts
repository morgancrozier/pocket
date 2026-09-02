import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthoritativeBotScheduler,
  BOARD_REVEAL_DELAY_MS,
  BOT_ACTION_DELAY_MS,
  botPacingDelay,
} from "@/lib/poker/bot-pacing";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerSituation } from "@/types/poker";

function state(overrides: Partial<PokerSituation>): PokerSituation {
  return { ...INITIAL_SITUATION, ...overrides };
}

describe("authoritative bot pacing", () => {
  afterEach(() => vi.useRealTimers());

  it("uses four-second action beats and one shorter board-reveal beat", () => {
    const afterHuman = state({
      stateVersion: INITIAL_SITUATION.stateVersion + 1,
      isYourTurn: false,
      currentActorId: "alex",
    });
    const afterStreet = state({
      ...afterHuman,
      stateVersion: afterHuman.stateVersion + 1,
      street: "turn",
      board: [...INITIAL_SITUATION.board, "2c"],
    });

    expect(botPacingDelay(INITIAL_SITUATION, afterHuman)).toBe(
      BOT_ACTION_DELAY_MS,
    );
    expect(botPacingDelay(afterHuman, afterStreet)).toBe(
      BOARD_REVEAL_DELAY_MS,
    );
  });

  it("runs one scheduled step, preserves order while skipped, and stops at the human", async () => {
    vi.useFakeTimers();
    const scheduler = new AuthoritativeBotScheduler();
    const order: string[] = [];

    scheduler.schedule({
      sequenceKey: "game:hand-1",
      stateKey: "version-1",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async () => {
        order.push("Theo calls");
      },
    });
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS - 1);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["Theo calls"]);

    scheduler.schedule({
      sequenceKey: "game:hand-1",
      stateKey: "version-2",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async () => {
        order.push("Alex checks");
      },
    });
    scheduler.skipToHuman();
    await vi.runAllTimersAsync();
    expect(order).toEqual(["Theo calls", "Alex checks"]);

    scheduler.schedule({
      sequenceKey: "game:hand-1",
      stateKey: "version-3",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async () => {
        order.push("June folds");
      },
    });
    await vi.runAllTimersAsync();
    scheduler.stopAtHuman();
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    expect(order).toEqual(["Theo calls", "Alex checks", "June folds"]);

    scheduler.schedule({
      sequenceKey: "game:hand-2",
      stateKey: "version-1",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async () => {
        order.push("next hand bot");
      },
    });
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS - 1);
    expect(order).toEqual(["Theo calls", "Alex checks", "June folds"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual([
      "Theo calls",
      "Alex checks",
      "June folds",
      "next hand bot",
    ]);
  });

  it("cancels pending and in-flight work without duplicate actions", async () => {
    vi.useFakeTimers();
    const scheduler = new AuthoritativeBotScheduler();
    const actions: string[] = [];
    let observedAbort = false;

    scheduler.schedule({
      sequenceKey: "game:hand-1",
      stateKey: "version-1",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async () => {
        actions.push("pending");
      },
    });
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    expect(actions).toEqual([]);

    scheduler.schedule({
      sequenceKey: "game:hand-2",
      stateKey: "version-2",
      delayMs: BOT_ACTION_DELAY_MS,
      run: async (signal) => {
        actions.push("started");
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    scheduler.skipToHuman();
    scheduler.skipToHuman();
    await vi.advanceTimersByTimeAsync(0);
    expect(actions).toEqual(["started"]);
    scheduler.cancel();
    await vi.runAllTimersAsync();
    expect(observedAbort).toBe(true);
    expect(actions).toEqual(["started"]);
  });
});
