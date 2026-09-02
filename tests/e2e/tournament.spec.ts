import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type Route } from "@playwright/test";

function eventObjects(fields: string[], rows: unknown[][]) {
  return rows.map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index]])),
  );
}

const anonymousUserByPage = new WeakMap<Page, Promise<string>>();

function testAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const allowManaged = process.env.POCKET_ALLOW_MANAGED_E2E === "1";
  const isLocal =
    Boolean(url) &&
    ["127.0.0.1", "localhost"].includes(new URL(url!).hostname);
  if (!url || !secretKey || (!isLocal && !allowManaged)) {
    throw new Error(
      "The browser suite requires isolated local Supabase unless POCKET_ALLOW_MANAGED_E2E=1 is set explicitly.",
    );
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.beforeEach(async ({ page }) => {
  testAdminClient();
  anonymousUserByPage.set(
    page,
    page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/auth/v1/signup"),
        { timeout: 15_000 },
      )
      .then(async (response) => {
        const payload = (await response.json()) as { user?: { id?: unknown } };
        if (typeof payload.user?.id !== "string") {
          throw new Error("Anonymous signup did not return a user ID.");
        }
        return payload.user.id;
      }),
  );
});

test.afterEach(async ({ page }) => {
  const userId = await anonymousUserByPage.get(page);
  if (!userId) throw new Error("The test browser did not create an anonymous user.");
  await page.close();
  const admin = testAdminClient();
  const { error: gameCleanupError } = await admin
    .from("games")
    .delete()
    .eq("id", userId);
  expect(gameCleanupError).toBeNull();
  const { error: userCleanupError } = await admin.auth.admin.deleteUser(userId);
  expect(userCleanupError).toBeNull();
});

const initialSituation = {
  gameId: "pocket-demo",
  handNumber: 4,
  stateVersion: 18,
  street: "turn",
  isYourTurn: true,
  currentActorId: "hero",
  yourPlayerId: "hero",
  yourSeat: 0,
  yourCards: ["As", "Ts"],
  yourStack: 32,
  board: ["Ah", "9s", "4c", "7d"],
  pot: 12,
  currentBet: 4,
  toCall: 4,
  lastFullRaiseSize: 4,
  smallBlind: 2,
  bigBlind: 4,
  dealerSeat: 3,
  smallBlindSeat: 0,
  bigBlindSeat: 1,
  pots: [
    {
      index: 0,
      type: "main",
      amount: 12,
      eligiblePlayerIds: ["hero", "bot-east", "bot-north"],
      winnerPlayerIds: [],
      awards: [],
    },
  ],
  unmatchedContribution: null,
  legalActions: [
    { type: "fold" },
    { type: "call", amount: 4 },
    { type: "raise", minTotal: 8, maxTotal: 32 },
  ],
  players: [
    {
      id: "hero",
      displayName: "Morgan",
      seat: 0,
      stack: 32,
      status: "active",
      committedThisStreet: 0,
      isBot: false,
      hasAgent: true,
    },
    {
      id: "bot-east",
      displayName: "Alex",
      seat: 1,
      stack: 36,
      status: "active",
      committedThisStreet: 4,
      isBot: true,
      hasAgent: false,
    },
    {
      id: "bot-north",
      displayName: "June",
      seat: 2,
      stack: 38,
      status: "active",
      committedThisStreet: 4,
      isBot: true,
      hasAgent: false,
    },
    {
      id: "bot-west",
      displayName: "Theo",
      seat: 3,
      stack: 42,
      status: "folded",
      committedThisStreet: 0,
      isBot: true,
      hasAgent: false,
    },
  ],
  recentActions: [
    {
      sequence: 1,
      street: "turn",
      playerId: "bot-east",
      playerName: "Alex",
      action: "bet",
      amount: 4,
    },
  ],
  handResult: null,
  gameResult: null,
};

function transitionResult<T>(situation: T, frames: T[] = [situation]) {
  return { situation, frames };
}

function terminalSituationFor(action: string, amount?: number) {
  return {
    ...initialSituation,
    stateVersion: 24,
    street: "showdown",
    isYourTurn: false,
    currentActorId: null,
    yourStack: 0,
    board: ["Ah", "9s", "4c", "7d", "2h"],
    pot: 80,
    currentBet: 0,
    toCall: 0,
    pots: [
      {
        index: 0,
        type: "main",
        amount: 80,
        eligiblePlayerIds: ["hero", "bot-east", "bot-north"],
        winnerPlayerIds: ["bot-east"],
        awards: [{ playerId: "bot-east", amount: 80 }],
      },
    ],
    unmatchedContribution: null,
    legalActions: [],
    players: [
      { ...initialSituation.players[0], stack: 0, status: "out" },
      {
        ...initialSituation.players[1],
        stack: 84,
        status: "active",
        revealedCards: ["Kh", "Kd"],
      },
      { ...initialSituation.players[2], stack: 34, status: "active" },
      { ...initialSituation.players[3], stack: 42, status: "folded" },
    ],
    recentActions: [
      ...initialSituation.recentActions,
      {
        sequence: 2,
        street: "turn",
        playerId: "hero",
        playerName: "Morgan",
        action,
        amount,
      },
    ],
    handResult: {
      reason: "showdown",
      winners: [{ playerId: "bot-east", playerName: "Alex", amount: 80 }],
    },
    gameResult: { outcome: "lost", reason: "human-eliminated" },
  };
}

const restartedSituation = {
  ...initialSituation,
  handNumber: 1,
  stateVersion: 25,
  street: "preflop",
  yourCards: ["Qh", "Jd"],
  yourStack: 40,
  board: [],
  pot: 5,
  currentBet: 2,
  toCall: 2,
  lastFullRaiseSize: 2,
  smallBlind: 1,
  bigBlind: 2,
  dealerSeat: 0,
  smallBlindSeat: 1,
  bigBlindSeat: 2,
  pots: [
    {
      index: 0,
      type: "main",
      amount: 5,
      eligiblePlayerIds: ["hero", "bot-east", "bot-north", "bot-west"],
      winnerPlayerIds: [],
      awards: [],
    },
  ],
  unmatchedContribution: null,
  legalActions: [
    { type: "fold" },
    { type: "call", amount: 2 },
    { type: "raise", minTotal: 4, maxTotal: 40 },
  ],
  players: [
    { ...initialSituation.players[0], stack: 40, committedThisStreet: 0 },
    {
      ...initialSituation.players[1],
      stack: 39,
      committedThisStreet: 1,
    },
    {
      ...initialSituation.players[2],
      stack: 38,
      committedThisStreet: 2,
    },
    {
      ...initialSituation.players[3],
      stack: 38,
      status: "active",
      committedThisStreet: 2,
    },
  ],
  recentActions: [],
  handResult: null,
  gameResult: null,
};

async function installWebMCPStub(
  page: Page,
  options: { failSuggestionOnce?: boolean } = {},
) {
  await page.addInitScript(({ failSuggestionOnce }) => {
    const tools = new Map<string, { name: string; execute: (input: object) => unknown }>();
    let suggestionFailed = false;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: { name: string; execute: (input: object) => unknown },
          options?: { signal?: AbortSignal },
        ) {
          if (
            failSuggestionOnce &&
            tool.name === "stage_recommendation" &&
            !suggestionFailed
          ) {
            suggestionFailed = true;
            throw new Error("stage_recommendation registration failed for test.");
          }
          tools.set(tool.name, tool);
          options?.signal?.addEventListener(
            "abort",
            () => {
              if (tools.get(tool.name) === tool) tools.delete(tool.name);
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
  }, options);
}

async function suggest(
  page: Page,
  input: {
    action: string;
    stateVersion: number;
    amount?: number;
    confidence?: number;
  },
) {
  return page.evaluate(async (suggestionInput) => {
    const tools = await document.modelContext.getTools();
    const suggestion = tools.find((tool) => tool.name === "stage_recommendation");
    if (!suggestion) throw new Error("stage_recommendation was not registered.");
    const result = await document.modelContext.executeTool(
      suggestion,
      suggestionInput,
    );
    return JSON.parse(String(result)) as {
      ok: boolean;
      error?: { code?: string; recovery?: string };
    };
  }, input);
}

test("an invalid sized WebMCP recommendation returns recovery and a valid retry renders", async ({
  page,
}) => {
  await installWebMCPStub(page);
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );

  await page.goto("/play");
  await expect(page.locator("header .status-pill")).toHaveText(
    "WebMCP tools ready",
  );

  const browserContract = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const currentSituation = tools.find(
      (tool) => tool.name === "get_current_situation",
    );
    const suggestion = tools.find((tool) => tool.name === "stage_recommendation");
    if (!currentSituation || !suggestion) {
      throw new Error("Expected WebMCP tools were not registered.");
    }
    return {
      toolNames: tools.map((tool) => tool.name).sort(),
      currentDescription: currentSituation.description,
      currentResult: JSON.parse(
        String(
          await document.modelContext.executeTool(currentSituation, {}),
        ),
      ),
      suggestionDescription: suggestion.description,
      suggestionInputSchema: suggestion.inputSchema,
    };
  });
  expect(browserContract.toolNames).toEqual([
    "get_current_situation",
    "get_hand_history",
    "stage_recommendation",
  ]);
  expect(browserContract.currentDescription).toContain("authoritative");
  expect(browserContract.currentResult).toMatchObject({
    game: { stateVersion: initialSituation.stateVersion },
    context: {
      bettingRoundState: "bet",
      isFirstVoluntaryAction: false,
      foldedPlayers: [],
      summary: expect.stringContaining("Alex bet to 4"),
    },
    table: { nextToAct: { name: "Morgan", isHero: true } },
  });
  expect(
    eventObjects(
      browserContract.currentResult.context.eventFields,
      browserContract.currentResult.context.recentEvents,
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "Alex",
        action: "bet",
        finalStreetTotal: 4,
      }),
    ]),
  );
  expect(browserContract.currentResult.context.summary).not.toContain(
    "Theo folded",
  );
  expect(browserContract.suggestionDescription).toContain(
    "After deciding what the player should do",
  );
  expect(browserContract.suggestionDescription).toContain(
    "never executes the poker action",
  );
  expect(browserContract.suggestionInputSchema).toMatchObject({
    required: ["action", "stateVersion"],
    properties: {
      stateVersion: { type: "integer", minimum: 1 },
      amount: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
  });

  const invalid = await suggest(page, {
    action: "raise",
    amount: 7,
    stateVersion: initialSituation.stateVersion,
  });
  expect(invalid).toMatchObject({
    ok: false,
    error: {
      code: "INVALID_AMOUNT",
      recovery: expect.stringContaining("get_current_situation"),
    },
  });
  await expect(page.locator(".copilot-recommendation.is-current")).toHaveCount(0);

  const recovered = await suggest(page, {
    action: "raise",
    amount: 12,
    stateVersion: initialSituation.stateVersion,
  });
  expect(recovered).toMatchObject({ ok: true });
  await expect(page.locator(".copilot-recommendation.is-current")).toBeVisible();
  await expect(page.locator(".suggestion-action")).toHaveText("Raise to 12");
});

test("practice fallback is explicit and can retry the authoritative table", async ({
  page,
}) => {
  let stateRequests = 0;
  await installWebMCPStub(page);
  const failState = async (route: Route) => {
    stateRequests += 1;
    await route.fulfill({
      status: 503,
      json: { error: { message: "Live table unavailable." } },
    });
  };
  await page.route("**/api/games/demo/state", failState);

  await page.goto("/play");
  await expect(page.locator("header .status-pill")).toHaveText(
    "Practice fallback · WebMCP tools ready",
  );
  await expect(page.getByRole("button", { name: "Retry live table" })).toBeVisible();

  await page.unroute("**/api/games/demo/state", failState);
  await page.route("**/api/games/demo/state", async (route) => {
    stateRequests += 1;
    await route.fulfill({ status: 200, json: initialSituation });
  });
  await page.getByRole("button", { name: "Retry live table" }).click();
  await expect(page.locator("header .status-pill")).toHaveText(
    "WebMCP tools ready",
  );
  await expect(page.getByText("Practice fallback", { exact: false })).toHaveCount(0);
  expect(stateRequests).toBeGreaterThanOrEqual(2);
});

test("suggestion registration failure degrades status and later success clears it", async ({
  page,
}) => {
  await installWebMCPStub(page, { failSuggestionOnce: true });
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );
  await page.route("**/api/games/demo/action", (route) =>
    route.fulfill({
      status: 200,
      json: transitionResult({ ...initialSituation, stateVersion: 19 }),
    }),
  );

  await page.goto("/play");
  await expect(page.locator(".status-pill")).toContainText(
    "WebMCP needs attention",
  );

  await page.getByRole("button", { name: "Call 4" }).click();
  await expect(page.locator(".status-pill")).toContainText(
    "WebMCP tools ready",
  );
  await expect(page.locator(".status-pill")).not.toContainText(
    "WebMCP needs attention",
  );
});

test("authoritative bot frames play in order and can be skipped without another mutation", async ({
  page,
}) => {
  let actionRequests = 0;
  await installWebMCPStub(page);
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );

  const afterHuman = {
    ...initialSituation,
    stateVersion: 19,
    isYourTurn: false,
    currentActorId: "bot-east",
    legalActions: [],
    recentActions: [
      ...initialSituation.recentActions,
      {
        sequence: 2,
        street: "turn",
        playerId: "hero",
        playerName: "Morgan",
        action: "call",
        amount: 4,
      },
    ],
  };
  const afterBet = {
    ...afterHuman,
    stateVersion: 20,
    currentActorId: "bot-north",
    currentBet: 8,
    pot: 20,
    recentActions: [
      ...afterHuman.recentActions,
      {
        sequence: 3,
        street: "turn",
        playerId: "bot-east",
        playerName: "Alex",
        action: "bet",
        amount: 8,
      },
    ],
  };
  const ready = {
    ...afterBet,
    stateVersion: 21,
    isYourTurn: true,
    currentActorId: "hero",
    toCall: 8,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 8 },
      { type: "raise", minTotal: 16, maxTotal: 32 },
    ],
    recentActions: [
      ...afterBet.recentActions,
      {
        sequence: 4,
        street: "turn",
        playerId: "bot-north",
        playerName: "June",
        action: "fold",
      },
    ],
  };

  await page.route("**/api/games/demo/action", async (route) => {
    actionRequests += 1;
    await route.fulfill({
      status: 200,
      json: transitionResult(ready, [afterHuman, afterBet, ready]),
    });
  });

  await page.goto("/play");
  await page.getByRole("button", { name: "Call 4" }).click();

  await expect(
    page.getByRole("button", { name: "Skip to your turn" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex is acting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fold" })).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await document.modelContext.getTools()).map((tool) => tool.name),
      ),
    )
    .not.toContain("stage_recommendation");

  await expect(page.locator(".playback-status")).toHaveText("Alex bets · 8.");
  await page.getByRole("button", { name: "Skip to your turn" }).click();

  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible();
  await expect(
    page.locator(
      '.player-seat.seat-1 .seat-action-cue > [aria-hidden="true"]',
    ),
  ).toHaveText("Bet 8");
  await expect(page.getByRole("button", { name: "Call 8" })).toBeVisible();
  expect(actionRequests).toBe(1);
});

test("refresh during playback catches up to the committed state without replaying frames", async ({
  page,
}) => {
  await installWebMCPStub(page);
  let serverSituation: unknown = initialSituation;
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: serverSituation }),
  );

  const afterHuman = {
    ...initialSituation,
    stateVersion: 19,
    isYourTurn: false,
    currentActorId: "bot-east",
    legalActions: [],
    recentActions: [
      ...initialSituation.recentActions,
      {
        sequence: 2,
        street: "turn",
        playerId: "hero",
        playerName: "Morgan",
        action: "call",
        amount: 4,
      },
    ],
  };
  const final = {
    ...afterHuman,
    stateVersion: 20,
    isYourTurn: true,
    currentActorId: "hero",
    currentBet: 0,
    toCall: 0,
    legalActions: [
      { type: "check" },
      { type: "bet", minTotal: 4, maxTotal: 32 },
    ],
    recentActions: [
      ...afterHuman.recentActions,
      {
        sequence: 3,
        street: "turn",
        playerId: "bot-east",
        playerName: "Alex",
        action: "check",
      },
    ],
  };
  await page.route("**/api/games/demo/action", async (route) => {
    serverSituation = final;
    await route.fulfill({
      status: 200,
      json: transitionResult(final, [afterHuman, final]),
    });
  });

  await page.goto("/play");
  await page.getByRole("button", { name: "Call 4" }).click();
  await expect(
    page.getByRole("button", { name: "Skip to your turn" }),
  ).toBeVisible();
  await page.reload();

  await expect(page.getByText("Caught up — Alex checks.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Skip to your turn" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
  await expect(
    page.locator(".hand-feed-item").filter({ hasText: "Alex checks" }),
  ).toHaveCount(1);
});

test("reduced motion renders the final decision immediately with one causal summary", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installWebMCPStub(page);
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );
  const final = {
    ...initialSituation,
    stateVersion: 20,
    currentBet: 8,
    toCall: 8,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 8 },
      { type: "raise", minTotal: 16, maxTotal: 32 },
    ],
    recentActions: [
      ...initialSituation.recentActions,
      {
        sequence: 2,
        street: "turn",
        playerId: "bot-east",
        playerName: "Alex",
        action: "bet",
        amount: 8,
      },
    ],
  };
  await page.route("**/api/games/demo/action", (route) =>
    route.fulfill({
      status: 200,
      json: transitionResult(final),
    }),
  );

  await page.goto("/play");
  await page.getByRole("button", { name: "Call 4" }).click();

  await expect(
    page.getByText("Caught up — Facing Alex’s 8-chip bet.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Skip to your turn" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Call 8" })).toBeVisible();
});

test("safe tournament UI replaces and follows advice through restart", async ({
  page,
}) => {
  const actionBodies: unknown[] = [];
  const restartBodies: unknown[] = [];

  await installWebMCPStub(page);

  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );
  await page.route("**/api/games/demo/action", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      amount?: number;
    };
    actionBodies.push(body);
    const terminal = terminalSituationFor(body.action, body.amount);
    await route.fulfill({
      status: 200,
      json: transitionResult(terminal),
    });
  });
  await page.route("**/api/games/demo/restart", async (route) => {
    restartBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      json: transitionResult(restartedSituation),
    });
  });

  await page.setViewportSize({ width: 880, height: 900 });
  await page.goto("/play");
  await expect(page.locator("header .status-pill")).toHaveText(
    "WebMCP tools ready",
  );
  await expect(
    page.getByText("Blinds 2 / 4", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.locator(".player-seat")).toHaveCount(4);
  await page
    .getByRole("button", { name: /Ready for your agent.*WebMCP tools ready/ })
    .click();
  await expect(page.getByRole("heading", { name: "Ready for your agent" })).toBeVisible();
  await page.locator(".companion-rail-mobile-header button").click();

  const amount = page.getByRole("spinbutton", { name: "Raise to", exact: true });
  await expect(amount).toHaveValue("8");
  await expect(
    page.getByRole("button", { name: "Raise to 8", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "½ pot: 12", exact: true }).click();
  await expect(amount).toHaveValue("12");
  await expect(
    page.getByRole("button", { name: "Raise to 12", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Pot: 20", exact: true }).click();
  await expect(amount).toHaveValue("20");

  const slider = page.getByRole("slider", { name: "Raise to slider" });
  await slider.fill("16");
  await expect(amount).toHaveValue("16");
  await expect(
    page.getByRole("button", { name: "Raise to 16", exact: true }),
  ).toBeVisible();

  await amount.fill("");
  await expect(amount).toHaveValue("");
  await amount.fill("1");
  await amount.blur();
  await expect(amount).toHaveValue("8");
  expect(actionBodies).toHaveLength(0);

  await page.getByRole("button", { name: "All-in: 32", exact: true }).click();
  await expect(amount).toHaveValue("32");
  await expect(
    page.getByRole("button", { name: "Raise to 32", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Min: 8", exact: true }).click();
  await expect(amount).toHaveValue("8");
  expect(actionBodies).toHaveLength(0);

  await suggest(page, {
    action: "raise",
    amount: 12,
    stateVersion: initialSituation.stateVersion,
    confidence: 0.8,
  });
  await page
    .getByRole("button", { name: /Raise to 12.*WebMCP tools ready/ })
    .click();
  await expect(page.locator(".copilot-recommendation.is-current")).toBeVisible();
  await expect(page.locator(".suggestion-action")).toHaveText("Raise to 12");
  await expect(page.getByText("80% confidence")).toBeVisible();
  expect(actionBodies).toHaveLength(0);

  await suggest(page, {
    action: "call",
    stateVersion: initialSituation.stateVersion,
    confidence: 0.64,
  });
  await expect(page.locator(".suggestion-action")).toHaveText("Call 4");
  await expect(page.getByText("64% confidence")).toBeVisible();
  await expect(page.getByText("Raise to 12", { exact: true })).toHaveCount(0);
  expect(actionBodies).toHaveLength(0);

  await page.locator(".companion-rail-mobile-header button").click();
  await page.getByRole("button", { name: "Call 4", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You’re out" })).toBeVisible();
  await page
    .getByRole("button", {
      name: /Recommendation followed.*WebMCP tools ready/,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recommendation followed" }),
  ).toBeVisible();
  await expect(page.getByText("You confirmed Call 4.")).toBeVisible();
  await page.getByRole("button", { name: "Full history" }).click();
  await expect(page.locator(".history-recommendation-followed")).toHaveText(
    "followed",
  );
  await page.getByRole("button", { name: "Close full hand history" }).click();
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  expect(actionBodies).toEqual([
    { action: "call", expectedStateVersion: 18 },
  ]);
  await expect(page.getByText("King of hearts")).toHaveCount(0);
  await expect(page.locator('[aria-label="King of hearts"]')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await document.modelContext.getTools()).map((tool) => tool.name),
      ),
    )
    .not.toContain("stage_recommendation");

  await page.locator(".companion-rail-mobile-header button").click();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Hand 1", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Blinds 1 / 2", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Recommendation followed")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Ready for your agent.*WebMCP tools ready/,
    }),
  ).toBeVisible();
  expect(restartBodies).toEqual([{ expectedStateVersion: 24 }]);

  await page.setViewportSize({ width: 400, height: 860 });
  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible();
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});

test("rejected actions do not create receipts and accepted overrides do", async ({
  page,
}) => {
  const actionBodies: unknown[] = [];
  let rejectNextAction = true;

  await installWebMCPStub(page);
  await page.route("**/api/games/demo/state", (route) =>
    route.fulfill({ status: 200, json: initialSituation }),
  );
  await page.route("**/api/games/demo/action", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      amount?: number;
    };
    actionBodies.push(body);

    if (rejectNextAction) {
      rejectNextAction = false;
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: "STATE_CONFLICT",
            message: "The table changed before that action was accepted.",
          },
        },
      });
      return;
    }

    const terminal = terminalSituationFor(body.action, body.amount);
    await route.fulfill({
      status: 200,
      json: transitionResult(terminal),
    });
  });

  await page.setViewportSize({ width: 880, height: 900 });
  await page.goto("/play");
  await expect(page.locator("header .status-pill")).toHaveText(
    "WebMCP tools ready",
  );
  await suggest(page, {
    action: "raise",
    amount: 12,
    stateVersion: initialSituation.stateVersion,
    confidence: 0.8,
  });
  await page
    .getByRole("button", { name: /Raise to 12.*WebMCP tools ready/ })
    .click();
  await expect(page.locator(".copilot-recommendation.is-current")).toBeVisible();
  await page.locator(".companion-rail-mobile-header button").click();

  const amount = page.getByRole("spinbutton", { name: "Raise to", exact: true });
  await amount.fill("16");
  await page
    .getByRole("button", { name: "Raise to 16", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: /Raise to 12.*WebMCP tools ready/ }),
  ).toBeVisible();
  await expect(page.getByText("Recommendation followed")).toHaveCount(0);
  await expect(page.getByText("You overrode your copilot")).toHaveCount(0);
  expect(actionBodies).toHaveLength(1);

  await page
    .getByRole("button", { name: "Raise to 16", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Recommendation overridden.*WebMCP tools ready/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "You overrode your copilot" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your copilot suggested Raise to 12; you chose Raise to 16."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Full history" }).click();
  await expect(page.locator(".history-recommendation-overridden")).toHaveText(
    "overridden",
  );
  expect(actionBodies).toHaveLength(2);
  expect(actionBodies[1]).toEqual({
    action: "raise",
    amount: 16,
    expectedStateVersion: 18,
  });
});
