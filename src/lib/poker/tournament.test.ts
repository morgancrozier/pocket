import { describe, expect, it } from "vitest";
import {
  blindLevelForHand,
  createDemoGame,
  DEMO_GAME_ID,
  DEMO_HERO_ID,
  DEMO_PLAYERS,
  type DemoGameService,
} from "./demo-game";
import { MemoryDemoGameRepository } from "./demo-game-repository";
import {
  applyAuthoritativeAction,
  createAuthoritativeGame,
  getAuthoritativeVersion,
  getCurrentDecision,
  serializeAuthoritativeGame,
  type DemoPlayerDefinition,
  type ServerPokerDecision,
} from "./engine-adapter";
import type { PokerActionIntent, PokerSituation } from "@/types/poker";

function passiveIntentFromLegal(
  legalActions: PokerSituation["legalActions"],
): PokerActionIntent {
  const action =
    legalActions.find((candidate) => candidate.type === "check") ??
    legalActions.find((candidate) => candidate.type === "call") ??
    legalActions.find((candidate) => candidate.type === "fold");
  if (!action) throw new Error("No passive legal action is available.");
  return { action: action.type };
}

function passiveBot(decision: ServerPokerDecision): PokerActionIntent {
  return passiveIntentFromLegal(decision.legalActions);
}

function maximumIntent(situation: PokerSituation): PokerActionIntent {
  const sized = situation.legalActions.find(
    (action) => action.type === "raise" || action.type === "bet",
  );
  if (sized && typeof sized.maxTotal === "number") {
    return { action: sized.type, amount: sized.maxTotal };
  }
  return passiveIntentFromLegal(situation.legalActions);
}

async function settleHand(
  game: DemoGameService,
  initial: PokerSituation,
  chooseHuman: (situation: PokerSituation) => PokerActionIntent = (situation) =>
    passiveIntentFromLegal(situation.legalActions),
): Promise<PokerSituation> {
  let situation = initial;
  for (let guard = 0; !situation.handResult && guard < 150; guard += 1) {
    situation = situation.isYourTurn
      ? (
          await game.act({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
            intent: chooseHuman(situation),
          })
        ).situation
      : (
          await game.advanceBot({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
          })
        ).situation;
  }
  if (!situation.handResult) throw new Error("The hand did not settle.");
  return situation;
}

async function finishTournament(
  game: DemoGameService,
  chooseHuman: (situation: PokerSituation) => PokerActionIntent,
): Promise<PokerSituation> {
  let situation = await game.getSituation(DEMO_HERO_ID);
  for (let guard = 0; !situation.gameResult && guard < 500; guard += 1) {
    situation = situation.handResult
      ? (
          await game.startNextHand({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
          })
        ).situation
      : !situation.isYourTurn
        ? (
            await game.advanceBot({
              actorId: DEMO_HERO_ID,
              expectedStateVersion: situation.stateVersion,
            })
          ).situation
        : (
          await game.act({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
            intent: chooseHuman(situation),
          })
          ).situation;
  }
  if (!situation.gameResult) throw new Error("The tournament did not finish.");
  return situation;
}

async function seedLegacyGame(repository: MemoryDemoGameRepository) {
  const players: readonly DemoPlayerDefinition[] = DEMO_PLAYERS.map((player) => ({
    ...player,
    stack: 200,
  }));
  let authoritative = createAuthoritativeGame({
    gameId: DEMO_GAME_ID,
    players,
    deterministicSeed: 500,
  });
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = getCurrentDecision(authoritative);
    if (!decision.actorId || decision.actorId === DEMO_HERO_ID) break;
    authoritative = applyAuthoritativeAction(
      authoritative,
      decision.actorId,
      passiveBot(decision),
    );
  }
  await repository.createIfMissing({
    gameId: DEMO_GAME_ID,
    serializedState: serializeAuthoritativeGame(authoritative),
    stateVersion: getAuthoritativeVersion(authoritative),
  });
}

describe("Gate 2 quick tournament", () => {
  it("starts new sessions at 40 chips each and conserves 160 chips", async () => {
    const game = createDemoGame({ deterministicSeed: 42 });
    const situation = await game.getSituation(DEMO_HERO_ID);

    expect(
      situation.players.reduce((total, player) => total + player.stack, 0) +
        situation.pot,
    ).toBe(160);
    expect(situation.smallBlind).toBe(1);
    expect(situation.bigBlind).toBe(2);
    expect(await game.getChipTotal()).toBe(160);
  });

  it("escalates blinds on hands 4 and 7 while completing multiple hands", async () => {
    const repository = new MemoryDemoGameRepository();
    await seedLegacyGame(repository);
    const game = createDemoGame({
      deterministicSeed: 500,
      repository,
      chooseBotIntent: passiveBot,
    });
    let situation = await game.getSituation(DEMO_HERO_ID);

    for (let hand = 1; hand <= 7; hand += 1) {
      expect({
        smallBlind: situation.smallBlind,
        bigBlind: situation.bigBlind,
      }).toEqual(blindLevelForHand(hand));
      if (hand === 7) break;
      situation = await settleHand(game, situation);
      expect(situation.gameResult).toBeNull();
      situation = (
        await game.startNextHand({
          actorId: DEMO_HERO_ID,
          expectedStateVersion: situation.stateVersion,
        })
      ).situation;
      expect(situation.handNumber).toBe(hand + 1);
    }

    expect(await game.getChipTotal()).toBe(800);
  }, 10_000);

  it("ends immediately with a loss when the human is eliminated", async () => {
    const game = createDemoGame({ deterministicSeed: 1 });
    const terminal = await finishTournament(game, maximumIntent);

    expect(terminal.gameResult).toEqual({
      outcome: "lost",
      reason: "human-eliminated",
    });
    expect(terminal.players.find((player) => player.id === DEMO_HERO_ID)).toMatchObject({
      stack: 0,
      status: "out",
    });
    await expect(
      game.startNextHand({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: terminal.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "GAME_COMPLETE" });
    expect(await game.getChipTotal()).toBe(160);
  });

  it("ends with a win when the human is the only funded player", async () => {
    const game = createDemoGame({ deterministicSeed: 10 });
    const terminal = await finishTournament(game, maximumIntent);

    expect(terminal.gameResult).toEqual({
      outcome: "won",
      reason: "last-player-standing",
    });
    expect(terminal.players.filter((player) => player.stack > 0)).toHaveLength(1);
    expect(
      terminal.players
        .filter((player) => player.id !== DEMO_HERO_ID)
        .every((player) => player.status === "out"),
    ).toBe(true);
    expect(await game.getChipTotal()).toBe(160);
  });

  it("atomically restarts a terminal game with a monotonic version", async () => {
    const game = createDemoGame({ deterministicSeed: 1 });
    const terminal = await finishTournament(game, maximumIntent);
    const restarted = (
      await game.restartGame({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: terminal.stateVersion,
      })
    ).situation;

    expect(restarted.gameId).toBe(terminal.gameId);
    expect(restarted.handNumber).toBe(1);
    expect(restarted.stateVersion).toBeGreaterThan(terminal.stateVersion);
    expect(restarted.smallBlind).toBe(1);
    expect(restarted.bigBlind).toBe(2);
    expect(restarted.gameResult).toBeNull();
    expect(await game.getChipTotal()).toBe(160);
  });

  it("rejects non-terminal, stale, and concurrent restart requests", async () => {
    const repository = new MemoryDemoGameRepository();
    const initializer = createDemoGame({ deterministicSeed: 1, repository });
    const initial = await initializer.getSituation(DEMO_HERO_ID);
    await expect(
      initializer.restartGame({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: initial.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "GAME_IN_PROGRESS" });

    const terminal = await finishTournament(initializer, maximumIntent);
    const first = createDemoGame({ deterministicSeed: 1, repository });
    const second = createDemoGame({ deterministicSeed: 1, repository });
    const results = await Promise.allSettled([
      first.restartGame({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: terminal.stateVersion,
      }),
      second.restartGame({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: terminal.stateVersion,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "STALE_STATE" });
  });

  it("preserves a stored 200-chip session until Play again resets it to 40 chips", async () => {
    const repository = new MemoryDemoGameRepository();
    await seedLegacyGame(repository);
    const game = createDemoGame({ deterministicSeed: 500, repository });
    const situation = await game.getSituation(DEMO_HERO_ID);

    expect(await game.getChipTotal()).toBe(800);
    expect(situation.players.map((player) => player.stack).reduce((a, b) => a + b, 0) + situation.pot).toBe(800);
    expect(situation.smallBlind).toBe(1);
    expect(situation.bigBlind).toBe(2);

    const terminal = await finishTournament(game, maximumIntent);
    const restarted = (
      await game.restartGame({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: terminal.stateVersion,
      })
    ).situation;

    expect(restarted.players.every((player) => player.stack <= 40)).toBe(true);
    expect(
      restarted.players.reduce((total, player) => total + player.stack, 0) +
        restarted.pot,
    ).toBe(160);
    expect(await game.getChipTotal()).toBe(160);
  });
});
