import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOLD_RESULT_HOLD_MS,
  HandResultCountdown,
  SHOWDOWN_RESULT_HOLD_MS,
  handResultHoldDuration,
} from "@/lib/poker/hand-result-countdown";

describe("hand result countdown", () => {
  afterEach(() => vi.useRealTimers());

  it("holds folds for four seconds and showdowns for seven", () => {
    expect(handResultHoldDuration("fold")).toBe(FOLD_RESULT_HOLD_MS);
    expect(handResultHoldDuration("showdown")).toBe(
      SHOWDOWN_RESULT_HOLD_MS,
    );
  });

  it("ticks down and advances exactly once after the full hold", async () => {
    vi.useFakeTimers();
    const countdown = new HandResultCountdown();
    const ticks: number[] = [];
    const onElapsed = vi.fn();

    countdown.start({
      countdownKey: "fold:1",
      durationMs: FOLD_RESULT_HOLD_MS,
      onTick: (remaining) => ticks.push(remaining),
      onElapsed,
    });
    await vi.advanceTimersByTimeAsync(FOLD_RESULT_HOLD_MS - 1);
    expect(onElapsed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(ticks[0]).toBe(FOLD_RESULT_HOLD_MS);
    expect(ticks.at(-1)).toBe(0);
    await vi.runAllTimersAsync();
    expect(onElapsed).toHaveBeenCalledTimes(1);

    countdown.start({
      countdownKey: "fold:1",
      durationMs: FOLD_RESULT_HOLD_MS,
      onTick: (remaining) => ticks.push(remaining),
      onElapsed,
    });
    await vi.runAllTimersAsync();
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(ticks.at(-1)).toBe(0);
  });

  it("cancels a pending advance and replaces an earlier countdown", async () => {
    vi.useFakeTimers();
    const countdown = new HandResultCountdown();
    const firstElapsed = vi.fn();
    const secondElapsed = vi.fn();

    countdown.start({
      countdownKey: "fold:1",
      durationMs: FOLD_RESULT_HOLD_MS,
      onTick: vi.fn(),
      onElapsed: firstElapsed,
    });
    countdown.start({
      countdownKey: "showdown:2",
      durationMs: SHOWDOWN_RESULT_HOLD_MS,
      onTick: vi.fn(),
      onElapsed: secondElapsed,
    });
    await vi.advanceTimersByTimeAsync(FOLD_RESULT_HOLD_MS);
    expect(firstElapsed).not.toHaveBeenCalled();
    expect(secondElapsed).not.toHaveBeenCalled();

    countdown.cancel();
    await vi.runAllTimersAsync();
    expect(firstElapsed).not.toHaveBeenCalled();
    expect(secondElapsed).not.toHaveBeenCalled();
  });

  it("marks a manual completion so the same hand cannot restart", async () => {
    vi.useFakeTimers();
    const countdown = new HandResultCountdown();
    const onElapsed = vi.fn();

    countdown.start({
      countdownKey: "showdown:9",
      durationMs: SHOWDOWN_RESULT_HOLD_MS,
      onTick: vi.fn(),
      onElapsed,
    });
    countdown.complete("showdown:9");
    countdown.start({
      countdownKey: "showdown:9",
      durationMs: SHOWDOWN_RESULT_HOLD_MS,
      onTick: vi.fn(),
      onElapsed,
    });
    await vi.runAllTimersAsync();

    expect(onElapsed).not.toHaveBeenCalled();
  });
});
