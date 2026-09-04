import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { PlayingRoomSnapshot, RoomSnapshot } from "../../src/types/poker";

async function installWebMCPStub(context: BrowserContext) {
  await context.addInitScript(() => {
    const tools = new Map<
      string,
      { name: string; execute: (input: object) => unknown }
    >();
    const audit = {
      registrations: {} as Record<string, number>,
      aborts: {} as Record<string, number>,
      identities: {} as Record<string, number>,
      toolChanges: 0,
    };
    const toolIds = new WeakMap<object, number>();
    let nextToolId = 1;
    Object.defineProperty(window, "__pocketWebMCPAudit", {
      configurable: true,
      value: audit,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: { name: string; execute: (input: object) => unknown },
          options?: { signal?: AbortSignal },
        ) {
          const toolId = toolIds.get(tool) ?? nextToolId++;
          toolIds.set(tool, toolId);
          audit.identities[tool.name] = toolId;
          audit.registrations[tool.name] =
            (audit.registrations[tool.name] ?? 0) + 1;
          tools.set(tool.name, tool);
          audit.toolChanges += 1;
          options?.signal?.addEventListener(
            "abort",
            () => {
              audit.aborts[tool.name] = (audit.aborts[tool.name] ?? 0) + 1;
              if (tools.get(tool.name) === tool) {
                tools.delete(tool.name);
                audit.toolChanges += 1;
              }
            },
            { once: true },
          );
        },
        async getTools() {
          return [...tools.values()];
        },
        async executeTool(tool: { name: string }, input: object) {
          const registered = tools.get(tool.name);
          if (!registered) throw new Error(`Tool ${tool.name} is unavailable.`);
          return registered.execute(input);
        },
      },
    });
  });
}

async function getRoom(page: Page, roomCode: string): Promise<RoomSnapshot> {
  return page.evaluate(async (code) => {
    const response = await fetch(`/api/rooms/${code}/state`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`State failed with ${response.status}.`);
    return response.json();
  }, roomCode);
}

async function mutate(
  page: Page,
  roomCode: string,
  operation: "action" | "advance",
  body: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ code, operationName, requestBody }) => {
      const response = await fetch(`/api/rooms/${code}/${operationName}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      return {
        status: response.status,
        payload: await response.json(),
      };
    },
    { code: roomCode, operationName: operation, requestBody: body },
  );
}

async function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await document.modelContext.getTools()).map((tool) => tool.name).sort(),
  );
}

async function webMCPAudit(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pocketWebMCPAudit: {
            registrations: Record<string, number>;
            aborts: Record<string, number>;
            identities: Record<string, number>;
            toolChanges: number;
          };
        }
      ).__pocketWebMCPAudit,
  );
}

async function executeTool(
  page: Page,
  name: string,
  input: Record<string, unknown> = {},
) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`Tool ${toolName} is unavailable.`);
      return JSON.parse(
        await document.modelContext.executeTool(tool, toolInput),
      ) as unknown;
    },
    { toolName: name, toolInput: input },
  );
}

function playing(room: RoomSnapshot): PlayingRoomSnapshot {
  if (room.phase === "waiting") throw new Error("Expected a playing room.");
  return room;
}

function botIsActing(room: PlayingRoomSnapshot): boolean {
  return Boolean(
    room.situation.players.find(
      (player) =>
        player.id === room.situation.currentActorId && player.isBot,
    ),
  );
}

async function advanceBotsToHuman(
  page: Page,
  roomCode: string,
  initial: PlayingRoomSnapshot,
): Promise<PlayingRoomSnapshot> {
  let room = initial;
  for (let guard = 0; botIsActing(room); guard += 1) {
    if (guard >= 100) throw new Error("Bot actions did not reach a human.");
    const advanced = await mutate(page, roomCode, "advance", {
      expectedRevision: room.revision,
    });
    expect([200, 409]).toContain(advanced.status);
    room = playing(await getRoom(page, roomCode));
  }
  return room;
}

function safePayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /"(?:engine_state|engineState|deck|burn|burnCards|burn_cards)"\s*:/,
  );
  expect(serialized).not.toMatch(/"(?:rank|suit)"\s*:/);
}

async function waitForRevision(page: Page, roomCode: string, minimum: number) {
  await expect
    .poll(async () => (await getRoom(page, roomCode)).revision, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(minimum);
}

test("real two-browser room remains seat-safe through spectating and restart", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const allowManaged = process.env.POCKET_ALLOW_MANAGED_E2E === "1";
  const isLocal =
    Boolean(supabaseUrl) &&
    ["127.0.0.1", "localhost"].includes(new URL(supabaseUrl!).hostname);
  if (!supabaseUrl || !secretKey || (!isLocal && !allowManaged)) {
    throw new Error(
      "The multiplayer browser suite requires isolated local Supabase unless POCKET_ALLOW_MANAGED_E2E=1 is set explicitly.",
    );
  }
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await Promise.all([installWebMCPStub(contextA), installWebMCPStub(contextB)]);
  let pageA = await contextA.newPage();
  let pageB = await contextB.newPage();
  const observedPayloads: unknown[] = [];
  let roomCode: string | null = null;
  let gameId: string | null = null;

  for (const page of [pageA, pageB]) {
    page.on("response", async (response) => {
      if (!response.url().includes("/api/rooms/")) return;
      if (!response.headers()["content-type"]?.includes("application/json")) return;
      try {
        observedPayloads.push(await response.json());
      } catch {
        // A navigation may dispose a response body after the safety assertion path.
      }
    });
  }

  try {
    await pageA.goto("/");
    await pageA.getByRole("button", { name: /Play with Friends/ }).click();
    await pageA.getByRole("button", { name: /Host a game/ }).click();
    await expect(pageA.locator("#host-display-name")).toBeFocused();
    await pageA.locator("#host-display-name").fill("Morgan");
    await pageA.getByRole("button", { name: "Create table" }).click();
    await expect(pageA).toHaveURL(/\/table\/[A-Z0-9]{8}$/, {
      timeout: 15_000,
    });
    roomCode = new URL(pageA.url()).pathname.split("/").at(-1)!;
    await expect(pageA.getByText("Waiting room")).toBeVisible();
    const ownerWaiting = await getRoom(pageA, roomCode);
    gameId = ownerWaiting.gameId;
    expect(ownerWaiting.viewer).toMatchObject({ seat: 0, isOwner: true });

    const secondOwnerTab = await contextA.newPage();
    await secondOwnerTab.goto(`/table/${roomCode}`);
    await expect(secondOwnerTab.getByText("Waiting room")).toBeVisible();
    const ownerResumed = await getRoom(secondOwnerTab, roomCode);
    expect(ownerResumed.viewer.playerId).toBe(ownerWaiting.viewer.playerId);
    expect(ownerResumed.viewer.seat).toBe(0);
    expect(await toolNames(pageA)).toEqual([]);
    expect(await toolNames(secondOwnerTab)).toEqual([]);

    await pageB.goto(`/table/${roomCode}`);
    await expect(pageB.getByText("Take the second seat")).toBeVisible();
    await pageB.goto("/");
    await pageB.getByRole("button", { name: /Play with Friends/ }).click();
    await pageB.getByRole("button", { name: /Join with a code/ }).click();
    await expect(pageB.locator("#join-room-code")).toBeFocused();
    await pageB.locator("#join-room-code").fill("ZZZZZZZZ");
    await pageB.locator("#join-display-name-home").fill("Morgan");
    await pageB.getByRole("button", { name: "Join table" }).click();
    await expect(
      pageB.getByText("That Pocket room does not exist."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(pageB).toHaveURL(/\/$/);
    await pageB.locator("#join-room-code").fill(roomCode);
    await pageB.getByRole("button", { name: "Join table" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/table/${roomCode}$`));
    await expect(pageB.getByText("You have the second seat")).toBeVisible();
    const guestWaiting = await getRoom(pageB, roomCode);
    expect(guestWaiting.viewer).toMatchObject({
      seat: 2,
      displayName: "Morgan",
      isOwner: false,
    });
    expect(guestWaiting.viewer.playerId).not.toBe(ownerWaiting.viewer.playerId);
    expect(await toolNames(pageB)).toEqual([]);
    await expect
      .poll(async () => (await getRoom(pageA, roomCode!)).revision)
      .toBe(guestWaiting.revision);
    await expect(
      pageA.locator('.waiting-seat[data-human="true"]'),
    ).toHaveCount(2, { timeout: 15_000 });

    let delayedCommittedStart = false;
    await pageA.route(`**/api/rooms/${roomCode}/start`, async (route) => {
      if (delayedCommittedStart) {
        await route.continue();
        return;
      }
      delayedCommittedStart = true;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 7_500));
      await route.fulfill({ response }).catch(() => {
        // The client intentionally aborts first, then reconciles from state.
      });
    });

    await pageA.getByRole("button", { name: "Start table" }).click();
    await expect(pageA.getByLabel(/^Poker table,/)).toBeVisible({
      timeout: 15_000,
    });
    expect(delayedCommittedStart).toBe(true);
    let owner = playing(await getRoom(pageA, roomCode));
    owner = await advanceBotsToHuman(pageA, roomCode, owner);
    await waitForRevision(pageB, roomCode, owner.revision);
    const guest = playing(await getRoom(pageB, roomCode));
    expect(owner.revision).toBe(guest.revision);
    expect(owner.situation.board).toEqual(guest.situation.board);
    expect(owner.situation.pot).toBe(guest.situation.pot);
    expect(owner.situation.currentActorId).toBe(guest.situation.currentActorId);
    expect(owner.situation.recentActions).toEqual(guest.situation.recentActions);
    expect(owner.situation.yourPlayerId).not.toBe(guest.situation.yourPlayerId);
    expect(owner.situation.yourCards).toHaveLength(2);
    expect(guest.situation.yourCards).toHaveLength(2);
    expect(owner.situation.yourCards).not.toEqual(guest.situation.yourCards);
    safePayload(owner);
    safePayload(guest);

    await expect
      .poll(() => toolNames(pageA))
      .toEqual([
        "get_current_situation",
        "get_hand_history",
        "stage_recommendation",
      ]);
    await expect
      .poll(() => toolNames(pageB))
      .toEqual([
        "get_current_situation",
        "get_hand_history",
        "stage_recommendation",
      ]);
    const initialOwnerTools = await webMCPAudit(pageA);
    const initialGuestTools = await webMCPAudit(pageB);
    const ownerToolView = (await executeTool(
      pageA,
      "get_current_situation",
    )) as {
      contractVersion: number;
      hero: { seat: number; name: string; cards: string[] };
      room: { phase: string; viewerStatus: string };
    };
    const guestToolView = (await executeTool(
      pageB,
      "get_current_situation",
    )) as {
      contractVersion: number;
      hero: { seat: number; name: string; cards: string[] };
      room: { phase: string; viewerStatus: string };
    };
    expect(ownerToolView.contractVersion).toBe(3);
    expect(ownerToolView.hero.cards).toEqual(owner.situation.yourCards);
    expect(guestToolView.hero.cards).toEqual(guest.situation.yourCards);
    expect(ownerToolView.hero.seat).not.toBe(guestToolView.hero.seat);
    expect(ownerToolView.room.phase).toBe("active");
    expect(guestToolView.room.viewerStatus).toBe("seated");

    const actingPage =
      owner.situation.currentActorId === owner.viewer.playerId ? pageA : pageB;
    const observingPage = actingPage === pageA ? pageB : pageA;
    const actingRoom = actingPage === pageA ? owner : guest;
    const observingToolView = (await executeTool(
      observingPage,
      "get_current_situation",
    )) as { game: { stateVersion: number } };
    const opponentRecommendation = (await executeTool(
      observingPage,
      "stage_recommendation",
      {
        action: "check",
        stateVersion: observingToolView.game.stateVersion,
      },
    )) as { ok: boolean; error?: { code?: string } };
    expect(opponentRecommendation).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
    const maximum = actingRoom.situation.legalActions.find(
      (action) => action.type === "bet" || action.type === "raise",
    );
    if (maximum) {
      await actingPage
        .getByRole("button", {
          name: maximum.type === "raise" ? "Raise to…" : "Bet…",
          exact: true,
        })
        .click();
      await actingPage.getByRole("button", { name: /^All-in:/ }).click();
      await actingPage
        .getByRole("button", {
          name: new RegExp(
            maximum.type === "raise"
              ? `^Raise to ${maximum.maxTotal}`
              : `^Bet ${maximum.maxTotal}`,
          ),
        })
        .click();
    } else {
      const passive =
        actingRoom.situation.legalActions.find((action) => action.type === "check") ??
        actingRoom.situation.legalActions.find((action) => action.type === "call") ??
        actingRoom.situation.legalActions.find((action) => action.type === "fold");
      if (!passive) throw new Error("The current human has no legal UI action.");
      const buttonName =
        passive.type === "call"
          ? new RegExp(`^Call ${passive.amount}$`)
          : new RegExp(`^${passive.type}$`, "i");
      await actingPage.getByRole("button", { name: buttonName }).click();
    }
    await expect
      .poll(async () => (await getRoom(actingPage, roomCode!)).revision)
      .toBeGreaterThan(owner.revision);
    let afterClickedAction = playing(await getRoom(actingPage, roomCode));
    if (botIsActing(afterClickedAction)) {
      await expect(
        actingPage.getByRole("button", { name: "Skip to your turn" }),
      ).toBeVisible();
      await actingPage
        .getByRole("button", { name: "Skip to your turn" })
        .click();
      await expect
        .poll(async () => botIsActing(playing(await getRoom(actingPage, roomCode!))))
        .toBe(false);
      afterClickedAction = playing(await getRoom(actingPage, roomCode));
    }
    await waitForRevision(observingPage, roomCode, afterClickedAction.revision);
    await expect(
      observingPage
        .locator(".decision-metrics div")
        .filter({ hasText: "Pot" })
        .locator("dd"),
    ).toHaveText(String(afterClickedAction.situation.pot));
    expect(
      afterClickedAction.situation.currentActorId === null ||
        [owner.viewer.playerId, guest.viewer.playerId].includes(
          afterClickedAction.situation.currentActorId,
        ),
    ).toBe(true);
    expect(await webMCPAudit(pageA)).toEqual(initialOwnerTools);
    expect(await webMCPAudit(pageB)).toEqual(initialGuestTools);

    let adviceOwner = playing(await getRoom(pageA, roomCode));
    let adviceGuest = playing(await getRoom(pageB, roomCode));
    if (adviceOwner.situation.handResult) {
      const advanced = await mutate(pageA, roomCode, "advance", {
        expectedRevision: adviceOwner.revision,
      });
      expect([200, 409]).toContain(advanced.status);
      adviceOwner = playing(await getRoom(pageA, roomCode));
      adviceGuest = playing(await getRoom(pageB, roomCode));
    }
    adviceOwner = await advanceBotsToHuman(pageA, roomCode, adviceOwner);
    adviceGuest = playing(await getRoom(pageB, roomCode));
    const advicePage =
      adviceOwner.situation.currentActorId === adviceOwner.viewer.playerId
        ? pageA
        : pageB;
    const otherAdvicePage = advicePage === pageA ? pageB : pageA;
    const adviceRoom = advicePage === pageA ? adviceOwner : adviceGuest;
    const advice =
      adviceRoom.situation.legalActions.find((action) => action.type === "check") ??
      adviceRoom.situation.legalActions.find((action) => action.type === "call") ??
      adviceRoom.situation.legalActions.find((action) => action.type === "fold");
    if (!advice) throw new Error("The current human has no legal advice target.");
    await expect.poll(() => toolNames(advicePage)).toContain("stage_recommendation");
    const adviceRevision = adviceRoom.revision;
    await executeTool(advicePage, "stage_recommendation", {
      action: advice.type,
      stateVersion: adviceRoom.situation.stateVersion,
      confidence: 0.72,
    });
    await expect(advicePage.locator(".copilot-recommendation.is-current")).toBeVisible();
    await expect(otherAdvicePage.locator(".copilot-recommendation.is-current")).toHaveCount(0);
    expect((await getRoom(pageA, roomCode)).revision).toBe(adviceRevision);
    expect((await getRoom(pageB, roomCode)).revision).toBe(adviceRevision);

    const stableOwnerId = (await getRoom(pageA, roomCode)).viewer.playerId;
    const stableGuestId = (await getRoom(pageB, roomCode)).viewer.playerId;
    await pageA.close();
    await pageB.close();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    await Promise.all([
      pageA.goto(`/table/${roomCode}`),
      pageB.goto(`/table/${roomCode}`),
    ]);
    await expect(pageA.getByLabel(/^Poker table,/)).toBeVisible();
    await expect(pageB.getByLabel(/^Poker table,/)).toBeVisible();
    expect((await getRoom(pageA, roomCode)).viewer.playerId).toBe(stableOwnerId);
    expect((await getRoom(pageB, roomCode)).viewer.playerId).toBe(stableGuestId);

    let spectatorChecked = false;
    let complete: PlayingRoomSnapshot | null = null;
    for (let guard = 0; guard < 300; guard += 1) {
      const currentOwner = playing(await getRoom(pageA, roomCode));
      const currentGuest = playing(await getRoom(pageB, roomCode));
      const spectator =
        currentOwner.viewer.status === "eliminated"
          ? { page: pageA, room: currentOwner }
          : currentGuest.viewer.status === "eliminated"
            ? { page: pageB, room: currentGuest }
            : null;
      if (spectator && !spectatorChecked) {
        await waitForRevision(spectator.page, roomCode, spectator.room.revision);
        await expect
          .poll(() => toolNames(spectator.page))
          .toEqual([
            "get_current_situation",
            "get_hand_history",
            "stage_recommendation",
          ]);
        await expect(
          spectator.page
            .getByLabel("Copilot and current hand")
            .getByText("Active", { exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        await expect
          .poll(async () => {
            const current = (await executeTool(
              spectator.page,
              "get_current_situation",
            )) as { room?: { viewerStatus?: string } };
            return current.room?.viewerStatus;
          })
          .toBe("eliminated");
        const view = (await executeTool(
          spectator.page,
          "get_current_situation",
        )) as Record<string, unknown>;
        expect(view).toMatchObject({
          room: { viewerStatus: "eliminated" },
          hero: { cards: [] },
          legalActions: [],
        });
        const spectatorRecommendation = (await executeTool(
          spectator.page,
          "stage_recommendation",
          {
            action: "check",
            stateVersion: spectator.room.situation.stateVersion,
          },
        )) as { ok: boolean; error?: { code?: string } };
        expect(spectatorRecommendation.ok).toBe(false);
        expect(spectatorRecommendation.error?.code).toMatch(
          /^(?:NOT_YOUR_TURN|HAND_COMPLETE|GAME_COMPLETE)$/,
        );
        safePayload(view);
        spectatorChecked = true;
      }

      if (currentOwner.phase === "complete") {
        complete = currentOwner;
        break;
      }

      if (currentOwner.situation.handResult) {
        const advanced = await mutate(pageA, roomCode, "advance", {
          expectedRevision: currentOwner.revision,
        });
        expect([200, 409]).toContain(advanced.status);
        continue;
      }

      if (botIsActing(currentOwner)) {
        const advanced = await mutate(pageA, roomCode, "advance", {
          expectedRevision: currentOwner.revision,
        });
        expect([200, 409]).toContain(advanced.status);
        continue;
      }

      const actorPage =
        currentOwner.situation.currentActorId === currentOwner.viewer.playerId
          ? pageA
          : pageB;
      const actor = actorPage === pageA ? currentOwner : currentGuest;
      const sized = actor.situation.legalActions.find(
        (action) => action.type === "bet" || action.type === "raise",
      );
      const fallback =
        actor.situation.legalActions.find((action) => action.type === "check") ??
        actor.situation.legalActions.find((action) => action.type === "call") ??
        actor.situation.legalActions.find((action) => action.type === "fold");
      const intent = sized
        ? { action: sized.type, amount: sized.maxTotal }
        : fallback
          ? { action: fallback.type }
          : null;
      if (!intent) throw new Error("The authoritative human turn has no action.");
      const acted = await mutate(actorPage, roomCode, "action", {
        actionId: crypto.randomUUID(),
        expectedRevision: actor.revision,
        ...intent,
      });
      expect([200, 409]).toContain(acted.status);
    }

    expect(spectatorChecked).toBe(true);
    expect(complete?.phase).toBe("complete");
    expect(complete?.result?.reason).toMatch(
      /last-player-standing|all-humans-eliminated/,
    );
    await waitForRevision(pageB, roomCode, complete!.revision);
    await expect(pageA.getByRole("button", { name: "Play again" })).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Play again" })).toHaveCount(0);
    await expect(
      pageB.getByText("Waiting for the table creator to play again."),
    ).toBeVisible();
    await expect(pageA.locator('.poker-table[data-game-complete="true"]')).toBeVisible();
    await expect(pageB.locator('.poker-table[data-game-complete="true"]')).toBeVisible();
    const terminalRevision = complete!.revision;
    await pageA.getByRole("button", { name: "Play again" }).click();
    await expect
      .poll(async () => (await getRoom(pageA, roomCode!)).revision, {
        timeout: 15_000,
      })
      .toBeGreaterThan(terminalRevision);
    const restartedOwner = playing(await getRoom(pageA, roomCode));
    await waitForRevision(pageB, roomCode, restartedOwner.revision);
    const restartedGuest = playing(await getRoom(pageB, roomCode));
    expect(restartedOwner.phase).toBe("active");
    expect(restartedOwner.viewer.playerId).toBe(stableOwnerId);
    expect(restartedGuest.viewer.playerId).toBe(stableGuestId);
    expect(restartedOwner.seats.filter((seat) => !seat.isBot)).toHaveLength(2);

    for (const payload of observedPayloads) safePayload(payload);
  } finally {
    let cleanupGameId = gameId;
    if (!cleanupGameId && roomCode) {
      const { data: roomRow } = await admin
        .from("games")
        .select("id")
        .eq("room_code", roomCode)
        .maybeSingle();
      cleanupGameId = roomRow?.id ?? null;
    }
    if (cleanupGameId) {
      const { data: humanRows } = await admin
        .from("game_players")
        .select("user_id")
        .eq("game_id", cleanupGameId)
        .not("user_id", "is", null);
      const userIds = (humanRows ?? []).map((row) => row.user_id as string);
      const { error: roomCleanupError } = await admin
        .from("games")
        .delete()
        .eq("id", cleanupGameId);
      expect(roomCleanupError).toBeNull();
      if (userIds.length) {
        const { error: demoCleanupError } = await admin
          .from("games")
          .delete()
          .in("id", userIds);
        expect(demoCleanupError).toBeNull();
      }
      const authCleanup = await Promise.all(
        userIds.map((userId) => admin.auth.admin.deleteUser(userId)),
      );
      expect(authCleanup.map((result) => result.error)).toEqual(
        userIds.map(() => null),
      );
    }
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
