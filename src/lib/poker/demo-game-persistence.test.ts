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

async function settlePersistedHand(
  repository: MemoryDemoGameRepository,
  seed: number,
): Promise<PokerSituation> {
  let service: DemoGameService = createDemoGame({
    deterministicSeed: seed,
    repository,
  });
  let situation = await service.getSituation(DEMO_HERO_ID);

  for (let guard = 0; !situation.handResult && guard < 20; guard += 1) {
    service = createDemoGame({ deterministicSeed: seed, repository });
    situation = await service.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: situation.stateVersion,
      intent: passiveIntent(situation),
    });
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
    const before = await firstService.getSituation(DEMO_HERO_ID);
    const afterAction = await firstService.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: before.stateVersion,
      intent: passiveIntent(before),
    });

    const recreatedService = createDemoGame({
      deterministicSeed: 999,
      repository,
    });
    const resumed = await recreatedService.getSituation(DEMO_HERO_ID);

    expect(resumed).toEqual(afterAction);
    expect(resumed.handNumber).toBe(afterAction.handNumber);
    expect(resumed.yourSeat).toBe(afterAction.yourSeat);
    expect(resumed.yourCards).toEqual(afterAction.yourCards);
    expect(resumed.stateVersion).toBe(afterAction.stateVersion);
    expect(resumed.recentActions).toEqual(afterAction.recentActions);
  });

  it("accepts exactly one concurrent action and conflicts before the loser runs bots", async () => {
    const repository = new MemoryDemoGameRepository();
    const initializer = createDemoGame({ deterministicSeed: 63, repository });
    const before = await initializer.getSituation(DEMO_HERO_ID);
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
    expect(botSpies[acceptedIndexes[0]!]!.mock.calls.length).toBeGreaterThan(0);
    expect(repository.committedRevisionCount(DEMO_GAME_ID)).toBe(1);

    const accepted = (
      outcomes[acceptedIndexes[0]!] as PromiseFulfilledResult<PokerSituation>
    ).value;
    const persisted = await createDemoGame({ repository }).getSituation(
      DEMO_HERO_ID,
    );
    expect(persisted).toEqual(accepted);
  });

  it("rejects illegal and out-of-turn mutations without holding a claim", async () => {
    const repository = new MemoryDemoGameRepository();
    const service = createDemoGame({ deterministicSeed: 74, repository });
    const before = await service.getSituation(DEMO_HERO_ID);

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
    expect(accepted.stateVersion).toBeGreaterThan(before.stateVersion);
    expect(repository.committedRevisionCount(DEMO_GAME_ID)).toBe(1);
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
    expect(JSON.parse(webmcpSerialized)).toEqual(situation);
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
    expect(
      isSerializedPokerSituationPrivate(
        webmcpSerialized,
        authoritative,
        DEMO_HERO_ID,
      ),
    ).toBe(true);
  });
});
