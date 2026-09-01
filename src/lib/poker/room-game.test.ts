import { describe, expect, it } from "vitest";
import { createRoomGame } from "@/lib/poker/room-game";
import { MemoryRoomGameRepository } from "@/lib/poker/room-game-repository";
import type {
  PlayingRoomSnapshot,
  PokerActionIntent,
  PokerSituation,
  RoomSnapshot,
} from "@/types/poker";

function ids() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

function playing(snapshot: RoomSnapshot): PlayingRoomSnapshot {
  expect(snapshot.phase).not.toBe("waiting");
  return snapshot as PlayingRoomSnapshot;
}

function passiveIntent(situation: PokerSituation): PokerActionIntent {
  const legal =
    situation.legalActions.find((action) => action.type === "check") ??
    situation.legalActions.find((action) => action.type === "call") ??
    situation.legalActions.find((action) => action.type === "fold");
  expect(legal).toBeDefined();
  return { action: legal!.type };
}

function maximumIntent(situation: PokerSituation): PokerActionIntent {
  const sized = situation.legalActions.find(
    (action) => action.type === "bet" || action.type === "raise",
  );
  if (sized && typeof sized.max === "number") {
    return { action: sized.type, amount: sized.max };
  }
  return passiveIntent(situation);
}

async function startedRoom(seed = 11) {
  const repository = new MemoryRoomGameRepository();
  const uuid = ids();
  const service = createRoomGame({
    repository,
    deterministicSeed: seed,
    uuid,
    roomCode: () => "POCKET33",
  });
  const waiting = await service.create("creator-user", "Morgan");
  await service.join(waiting.roomCode, "guest-user", "Morgan");
  const started = await service.start(
    waiting.roomCode,
    "creator-user",
    (await service.get(waiting.roomCode, "creator-user")).revision,
  );
  return { repository, service, roomCode: waiting.roomCode, started };
}

async function completeRoom(seed: number) {
  const started = await startedRoom(seed);
  let room = playing(await started.service.get(started.roomCode, "creator-user"));
  let spectatorObserved = false;

  for (let guard = 0; room.phase !== "complete" && guard < 300; guard += 1) {
    const creator = playing(
      await started.service.get(started.roomCode, "creator-user"),
    );
    const guest = playing(
      await started.service.get(started.roomCode, "guest-user"),
    );
    spectatorObserved ||=
      (creator.phase === "active" && creator.viewer.status === "eliminated") ||
      (guest.phase === "active" && guest.viewer.status === "eliminated");

    if (creator.situation.handResult) {
      const advanced = await started.service.advance(
        started.roomCode,
        creator.viewer.status === "eliminated" ? "guest-user" : "creator-user",
        creator.revision,
      );
      room = playing(advanced.room);
      continue;
    }

    const actorId = creator.situation.currentActorId;
    const actorUser =
      actorId === creator.viewer.playerId ? "creator-user" : "guest-user";
    const actorView = actorUser === "creator-user" ? creator : guest;
    room = playing(
      (
        await started.service.act({
          roomCode: started.roomCode,
          userId: actorUser,
          actionId: `00000000-0000-4000-8000-${String(guard + 5_000).padStart(12, "0")}`,
          expectedRevision: actorView.revision,
          intent: maximumIntent(actorView.situation),
        })
      ).room,
    );
  }

  expect(room.phase).toBe("complete");
  return { ...started, room, spectatorObserved };
}

describe("Gate 3 multiplayer room", () => {
  it("creates fixed seats, resumes one session, permits one guest, and locks the roster", async () => {
    const repository = new MemoryRoomGameRepository();
    const service = createRoomGame({
      repository,
      deterministicSeed: 4,
      uuid: ids(),
      roomCode: () => "ROOMTEST",
    });

    const created = await service.create("creator-user", "Morgan");
    expect(created).toMatchObject({
      phase: "waiting",
      roomCode: "ROOMTEST",
      revision: 1,
      viewer: { seat: 0, isOwner: true },
      canStart: true,
    });
    expect(created.seats.map((seat) => [seat.seat, seat.isBot])).toEqual([
      [0, false],
      [1, true],
      [2, true],
      [3, true],
    ]);

    const resumed = await service.join("ROOMTEST", "creator-user", "Changed");
    expect(resumed.revision).toBe(1);
    expect(resumed.viewer.playerId).toBe(created.viewer.playerId);
    expect(resumed.viewer.displayName).toBe("Morgan");

    const guest = await service.join("ROOMTEST", "guest-user", "Morgan");
    expect(guest.revision).toBe(2);
    expect(guest.viewer.seat).toBe(2);
    expect(guest.viewer.playerId).not.toBe(created.viewer.playerId);

    await expect(
      service.join("ROOMTEST", "third-user", "Third"),
    ).rejects.toMatchObject({ code: "ROOM_FULL" });

    const active = await service.start("ROOMTEST", "creator-user", 2);
    expect(active.room.phase).toBe("active");
    await expect(
      service.join("ROOMTEST", "third-user", "Third"),
    ).rejects.toMatchObject({ code: "ROOM_ALREADY_STARTED" });
    await expect(
      service.leave("ROOMTEST", "guest-user"),
    ).rejects.toMatchObject({ code: "ROOM_NOT_WAITING" });
  });

  it("allows exactly one guest in a simultaneous join race", async () => {
    const repository = new MemoryRoomGameRepository();
    const service = createRoomGame({
      repository,
      uuid: ids(),
      roomCode: () => "JOINRACE",
    });
    await service.create("creator-user", "Morgan");

    const results = await Promise.allSettled([
      service.join("JOINRACE", "guest-a", "Alex"),
      service.join("JOINRACE", "guest-b", "Alex"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "ROOM_FULL" } });
  });

  it("projects two private seats from one state and stops bots at a human", async () => {
    const { service, roomCode } = await startedRoom(19);
    const creator = playing(await service.get(roomCode, "creator-user"));
    const guest = playing(await service.get(roomCode, "guest-user"));

    expect(creator.revision).toBe(guest.revision);
    expect(creator.situation.board).toEqual(guest.situation.board);
    expect(creator.situation.recentActions).toEqual(guest.situation.recentActions);
    expect(creator.situation.yourPlayerId).not.toBe(guest.situation.yourPlayerId);
    expect(creator.situation.yourCards).toHaveLength(2);
    expect(guest.situation.yourCards).toHaveLength(2);
    expect(creator.situation.yourCards).not.toEqual(guest.situation.yourCards);

    const actor = creator.situation.currentActorId;
    expect([creator.viewer.playerId, guest.viewer.playerId]).toContain(actor);
    const actorUser = actor === creator.viewer.playerId ? "creator-user" : "guest-user";
    const actorView = actorUser === "creator-user" ? creator : guest;
    const result = await service.act({
      roomCode,
      userId: actorUser,
      actionId: "00000000-0000-4000-8000-000000009999",
      expectedRevision: actorView.revision,
      intent: passiveIntent(actorView.situation),
    });
    const next = playing(result.room);
    expect(
      next.situation.currentActorId === null ||
        [creator.viewer.playerId, guest.viewer.playerId].includes(
          next.situation.currentActorId,
        ),
    ).toBe(true);
  });

  it("replays an action id exactly once and rejects mismatched reuse", async () => {
    const { repository, service, roomCode } = await startedRoom(29);
    const creator = playing(await service.get(roomCode, "creator-user"));
    const guest = playing(await service.get(roomCode, "guest-user"));
    const actorUser =
      creator.situation.currentActorId === creator.viewer.playerId
        ? "creator-user"
        : "guest-user";
    const before = actorUser === "creator-user" ? creator : guest;
    const actionId = "00000000-0000-4000-8000-000000001111";
    const intent = passiveIntent(before.situation);
    const commitsBefore = repository.committedOperationCount();

    const first = await service.act({
      roomCode,
      userId: actorUser,
      actionId,
      expectedRevision: before.revision,
      intent,
    });
    const replay = await service.act({
      roomCode,
      userId: actorUser,
      actionId,
      expectedRevision: before.revision,
      intent,
    });

    expect(first.operation.status).toBe("accepted");
    expect(replay.operation.status).toBe("replayed");
    expect(replay.operation.resultRevision).toBe(first.operation.resultRevision);
    expect(repository.committedOperationCount() - commitsBefore).toBe(1);

    await expect(
      service.act({
        roomCode,
        userId: actorUser,
        actionId,
        expectedRevision: before.revision,
        intent: { action: intent.action === "fold" ? "call" : "fold" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("keeps an eliminated human as a spectator, completes without bot-only play, and lets only the creator restart", async () => {
    const { service, roomCode, room, spectatorObserved } = await completeRoom(3);
    expect(room.result).not.toBeNull();
    expect(spectatorObserved || room.result?.reason === "all-humans-eliminated").toBe(true);

    const eliminated = playing(await service.get(roomCode, "guest-user"));
    if (eliminated.viewer.status === "eliminated") {
      expect(eliminated.situation.yourCards).toEqual([]);
      expect(eliminated.situation.legalActions).toEqual([]);
      expect(eliminated.situation.isYourTurn).toBe(false);
    }

    await expect(
      service.restart({
        roomCode,
        userId: "guest-user",
        restartId: "00000000-0000-4000-8000-000000007777",
        expectedRevision: room.revision,
      }),
    ).rejects.toMatchObject({ code: "NOT_ROOM_OWNER" });

    const restarted = await service.restart({
      roomCode,
      userId: "creator-user",
      restartId: "00000000-0000-4000-8000-000000008888",
      expectedRevision: room.revision,
    });
    expect(restarted.room.phase).toBe("active");
    expect(restarted.room.revision).toBeGreaterThan(room.revision);
    expect(restarted.room.seats.filter((seat) => !seat.isBot)).toHaveLength(2);
  });

  it.each([
    [1, "last-player-standing"],
    [2, "all-humans-eliminated"],
    [8, "last-player-standing"],
  ] as const)(
    "deterministically stops at the %s completion boundary",
    async (seed, reason) => {
      const { room, spectatorObserved } = await completeRoom(seed);
      expect(room.result?.reason).toBe(reason);
      expect(spectatorObserved).toBe(true);
      if (reason === "all-humans-eliminated") {
        expect(room.result?.winnerPlayerId).toBeNull();
      }
    },
  );
});
