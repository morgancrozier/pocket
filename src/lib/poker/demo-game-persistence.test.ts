import { describe, expect, it, vi } from "vitest";
import {
  createDemoGame,
  DEMO_GAME_ID,
  DEMO_HERO_ID,
  DEMO_PLAYERS,
  type DemoGameService,
} from "./demo-game";
import { MemoryDemoGameRepository } from "./demo-game-repository";
import {
  getAuthoritativeVersion,
  isSerializedPokerSituationPrivate,
  projectAuthoritativeGame,
  restoreAuthoritativeGame,
  type ServerPokerDecision,
} from "./engine-adapter";
import { createCurrentSituationTool } from "@/lib/webmcp/poker-tools";
import type {
  PokerActionIntent,
  PokerSituation,
} from "@/types/poker";

function passiveIntent(situation: PokerSituation): PokerActionIntent {
  const action =
    situation.legalActions.find((candidate) => candidate.type === "check") ??
    situation.legalActions.find((candidate) => candidate.type === "call") ??
    situation.legalActions.find((candidate) => candidate.type === "fold");

  expect(action).toBeDefined();
  return { action: action!.type };
}

async function advanceToHeroOrSettlement(
  service: DemoGameService,
  initial: PokerSituation,
): Promise<PokerSituation> {
  let situation = initial;
  for (let guard = 0; !situation.isYourTurn && !situation.handResult; guard += 1) {
    if (guard >= 100) throw new Error("Bot actions did not reach the hero.");
    situation = (
      await service.advanceBot({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: situation.stateVersion,
      })
    ).situation;
  }
  return situation;
}

async function settlePersistedHand(
  repository: MemoryDemoGameRepository,
  seed: number,
): Promise<PokerSituation> {
  let service: DemoGameService = createDemoGame({
    deterministicSeed: seed,
    repository,
  });
  let situation = await service.getSituation(DEMO_HERO_ID);

  for (let guard = 0; !situation.handResult && guard < 100; guard += 1) {
    service = createDemoGame({ deterministicSeed: seed, repository });
    situation = situation.isYourTurn
      ? (
          await service.act({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
            intent: passiveIntent(situation),
          })
        ).situation
      : (
          await service.advanceBot({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
          })
        ).situation;
  }

  return situation;
}

describe("Gate 2 durable demo boundary", () => {
  it("stores, loads, and reconstructs a serialized authoritative game", async () => {
    const repository = new MemoryDemoGameRepository();
    const service = createDemoGame({ deterministicSeed: 41, repository });
    const situation = await service.getSituation(DEMO_HERO_ID);
    const stored = await repository.load(DEMO_GAME_ID);

    expect(stored).not.toBeNull();
    const reconstructed = restoreAuthoritativeGame(stored!.serializedState);
    expect(getAuthoritativeVersion(reconstructed)).toBe(stored!.stateVersion);
    expect(projectAuthoritativeGame(reconstructed, DEMO_HERO_ID)).toEqual(
      situation,
    );
  });

  it("recreates the service without changing the hand, seat, cards, version, or history", async () => {
    const repository = new MemoryDemoGameRepository();
    const firstService = createDemoGame({
      deterministicSeed: 52,
      repository,
    });
    const before = await advanceToHeroOrSettlement(
      firstService,
      await firstService.getSituation(DEMO_HERO_ID),
    );
    const afterAction = await firstService.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: before.stateVersion,
      intent: passiveIntent(before),
    });

    expect(afterAction.frames.at(-1)).toEqual(afterAction.situation);
    expect(
      afterAction.frames.every(
        (frame, index, frames) =>
          index === 0 || frame.stateVersion > frames[index - 1]!.stateVersion,
      ),
    ).toBe(true);
    for (const frame of afterAction.frames) {
      const serializedFrame = JSON.stringify(frame);
      expect(serializedFrame).not.toContain('"deck"');
      expect(serializedFrame).not.toContain('"burnCards"');
      expect(serializedFrame).not.toContain('"holeCards"');
      expect(serializedFrame).not.toContain('"rank"');
      expect(serializedFrame).not.toContain('"suit"');
    }

    const recreatedService = createDemoGame({
      deterministicSeed: 999,
      repository,
    });
    const resumed = await recreatedService.getSituation(DEMO_HERO_ID);

    expect(resumed).toEqual(afterAction.situation);
    expect(resumed.handNumber).toBe(afterAction.situation.handNumber);
    expect(resumed.yourSeat).toBe(afterAction.situation.yourSeat);
    expect(resumed.yourCards).toEqual(afterAction.situation.yourCards);
    expect(resumed.stateVersion).toBe(afterAction.situation.stateVersion);
    expect(resumed.recentActions).toEqual(afterAction.situation.recentActions);
  });

  it("accepts exactly one concurrent human action without running any bot", async () => {
    const repository = new MemoryDemoGameRepository();
    const initializer = createDemoGame({ deterministicSeed: 63, repository });
    const before = await advanceToHeroOrSettlement(
      initializer,
      await initializer.getSituation(DEMO_HERO_ID),
    );
    const commitsBefore = repository.committedRevisionCount(DEMO_GAME_ID);
    const intent = passiveIntent(before);
    const firstBot = vi.fn((decision: ServerPokerDecision) => {
      const action =
        decision.legalActions.find((candidate) => candidate.type === "check") ??
        decision.legalActions.find((candidate) => candidate.type === "call") ??
        decision.legalActions.find((candidate) => candidate.type === "fold");
      if (!action) throw new Error("No passive bot action is available.");
      return { action: action.type } as PokerActionIntent;
    });
    const secondBot = vi.fn(firstBot.getMockImplementation()!);

    const first = createDemoGame({
      deterministicSeed: 63,
      repository,
      claimIdFactory: () => "00000000-0000-4000-8000-000000000001",
      chooseBotIntent: firstBot,
    });
    const second = createDemoGame({
      deterministicSeed: 63,
      repository,
      claimIdFactory: () => "00000000-0000-4000-8000-000000000002",
      chooseBotIntent: secondBot,
    });

    const outcomes = await Promise.allSettled([
      first.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: before.stateVersion,
        intent,
      }),
      second.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: before.stateVersion,
        intent,
      }),
    ]);

    const acceptedIndexes = outcomes.flatMap((outcome, index) =>
      outcome.status === "fulfilled" ? [index] : [],
    );
    const rejectedIndexes = outcomes.flatMap((outcome, index) =>
      outcome.status === "rejected" ? [index] : [],
    );
    expect(acceptedIndexes).toHaveLength(1);
    expect(rejectedIndexes).toHaveLength(1);
    expect(outcomes[rejectedIndexes[0]!] as PromiseRejectedResult).toMatchObject({
      reason: { code: "STALE_STATE" },
    });

    const botSpies = [firstBot, secondBot];
    expect(botSpies[rejectedIndexes[0]!]!).not.toHaveBeenCalled();
    expect(botSpies[acceptedIndexes[0]!]!).not.toHaveBeenCalled();
    expect(repository.committedRevisionCount(DEMO_GAME_ID)).toBe(
      commitsBefore + 1,
    );

    const accepted = (
      outcomes[acceptedIndexes[0]!] as PromiseFulfilledResult<
        Awaited<ReturnType<DemoGameService["act"]>>
      >
    ).value.situation;
    const persisted = await createDemoGame({ repository }).getSituation(
      DEMO_HERO_ID,
    );
    expect(persisted).toEqual(accepted);
  });

  it("commits exactly one bot action per version and exposes that intermediate state to WebMCP", async () => {
    const repository = new MemoryDemoGameRepository();
    const firstBot = vi.fn((decision: ServerPokerDecision) => {
      const action =
        decision.legalActions.find((candidate) => candidate.type === "check") ??
        decision.legalActions.find((candidate) => candidate.type === "call") ??
        decision.legalActions.find((candidate) => candidate.type === "fold");
      if (!action) throw new Error("No passive bot action is available.");
      return { action: action.type } as PokerActionIntent;
    });
    const secondBot = vi.fn(firstBot.getMockImplementation()!);
    const first = createDemoGame({
      judgeDemo: true,
      repository,
      chooseBotIntent: firstBot,
      claimIdFactory: () => "00000000-0000-4000-8000-000000000011",
    });
    const opening = await first.getSituation(DEMO_HERO_ID);
    const second = createDemoGame({
      judgeDemo: true,
      repository,
      chooseBotIntent: secondBot,
      claimIdFactory: () => "00000000-0000-4000-8000-000000000012",
    });

    const outcomes = await Promise.allSettled([
      first.advanceBot({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: opening.stateVersion,
      }),
      second.advanceBot({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: opening.stateVersion,
      }),
    ]);

    const accepted = outcomes.find(
      (outcome): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<DemoGameService["advanceBot"]>>
      > => outcome.status === "fulfilled",
    );
    expect(accepted).toBeDefined();
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(firstBot.mock.calls.length + secondBot.mock.calls.length).toBe(1);
    expect(repository.committedRevisionCount(DEMO_GAME_ID)).toBe(1);

    const intermediate = accepted!.value.situation;
    const persisted = await first.getSituation(DEMO_HERO_ID);
    expect(persisted).toEqual(intermediate);
    expect(intermediate.stateVersion).toBe(opening.stateVersion + 1);
    expect(intermediate.recentActions).toHaveLength(
      opening.recentActions.length + 1,
    );

    const webmcp = JSON.parse(
      await createCurrentSituationTool({
        getSituation: () => intermediate,
      }).execute({}),
    ) as { game: { stateVersion: number }; table: { nextToAct: unknown } };
    expect(webmcp.game.stateVersion).toBe(intermediate.stateVersion);
    expect(webmcp.table.nextToAct).toMatchObject({ isHero: true });
  });

  it("rejects illegal and out-of-turn mutations without holding a claim", async () => {
    const repository = new MemoryDemoGameRepository();
    const service = createDemoGame({ deterministicSeed: 74, repository });
    const before = await advanceToHeroOrSettlement(
      service,
      await service.getSituation(DEMO_HERO_ID),
    );
    const commitsBefore = repository.committedRevisionCount(DEMO_GAME_ID);

    await expect(
      service.act({
        actorId: "bot-east",
        expectedStateVersion: before.stateVersion,
        intent: { action: "call" },
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_TURN" });
    await expect(
      service.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: before.stateVersion,
        intent: { action: "check" },
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_ACTION" });

    const accepted = await service.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: before.stateVersion,
      intent: passiveIntent(before),
    });
    expect(accepted.situation.stateVersion).toBeGreaterThan(before.stateVersion);
    expect(repository.committedRevisionCount(DEMO_GAME_ID)).toBe(
      commitsBefore + 1,
    );
  });

  it("conserves chips through repeated persistence and settlement", async () => {
    const repository = new MemoryDemoGameRepository();
    const initial = createDemoGame({ deterministicSeed: 85, repository });
    expect(await initial.getChipTotal()).toBe(160);

    const settled = await settlePersistedHand(repository, 85);
    const recreated = createDemoGame({ deterministicSeed: 85, repository });

    expect(settled.handResult).not.toBeNull();
    expect(await recreated.getChipTotal()).toBe(160);
    expect(await recreated.getSituation(DEMO_HERO_ID)).toEqual(settled);
  });

  it("returns the hero cards while keeping stored private engine data out of safe responses", async () => {
    const repository = new MemoryDemoGameRepository();
    const service = createDemoGame({ deterministicSeed: 96, repository });
    const situation = await service.getSituation(DEMO_HERO_ID);
    const stored = await repository.load(DEMO_GAME_ID);
    const authoritative = restoreAuthoritativeGame(stored!.serializedState);
    const serialized = JSON.stringify(situation);
    const webmcpSerialized = await createCurrentSituationTool({
      getSituation: () => situation,
    }).execute({});
    const opponentCards = DEMO_PLAYERS.slice(1).flatMap(
      (player) => projectAuthoritativeGame(authoritative, player.id).yourCards,
    );

    expect(situation.yourCards).toHaveLength(2);
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"burnCards"');
    expect(serialized).not.toContain('"holeCards"');
    expect(serialized).not.toContain('"rank"');
    expect(serialized).not.toContain('"suit"');
    expect(JSON.parse(webmcpSerialized)).toMatchObject({
      contractVersion: 3,
      game: {
        gameId: situation.gameId,
        handNumber: situation.handNumber,
        stateVersion: situation.stateVersion,
      },
      hero: {
        seat: situation.yourSeat,
        cards: situation.yourCards,
        stack: situation.yourStack,
      },
      context: { summary: expect.any(String) },
    });
    expect(
      opponentCards.every(
        (card) => !serialized.includes(JSON.stringify(card)),
      ),
    ).toBe(true);
    expect(
      isSerializedPokerSituationPrivate(
        serialized,
        authoritative,
        DEMO_HERO_ID,
      ),
    ).toBe(true);
    expect(webmcpSerialized).not.toContain('"deck"');
    expect(webmcpSerialized).not.toContain('"burnCards"');
    expect(webmcpSerialized).not.toContain('"holeCards"');
    expect(
      opponentCards.every(
        (card) => !webmcpSerialized.includes(JSON.stringify(card)),
      ),
    ).toBe(true);
  });
});
