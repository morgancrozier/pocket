import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

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
  smallBlind: 2,
  bigBlind: 4,
  dealerSeat: 3,
  legalActions: [
    { type: "fold" },
    { type: "call", amount: 4 },
    { type: "raise", min: 8, max: 32 },
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
  smallBlind: 1,
  bigBlind: 2,
  dealerSeat: 0,
  legalActions: [
    { type: "fold" },
    { type: "call", amount: 2 },
    { type: "raise", min: 4, max: 40 },
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

async function installWebMCPStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, { name: string; execute: (input: object) => unknown }>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: { name: string; execute: (input: object) => unknown },
          options?: { signal?: AbortSignal },
        ) {
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
  });
}

async function suggest(
  page: Page,
  input: { action: string; amount?: number; confidence?: number },
) {
  await page.evaluate(async (suggestionInput) => {
    const tools = await document.modelContext.getTools();
    const suggestion = tools.find((tool) => tool.name === "suggest_action");
    if (!suggestion) throw new Error("suggest_action was not registered.");
    await document.modelContext.executeTool(suggestion, suggestionInput);
  }, input);
}

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
    await route.fulfill({
      status: 200,
      json: terminalSituationFor(body.action, body.amount),
    });
  });
  await page.route("**/api/games/demo/restart", async (route) => {
    restartBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: restartedSituation });
  });

  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto("/");
  await expect(page.getByText("WebMCP ready")).toBeVisible();
  await expect(page.getByText("Blinds 2/4", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("4 remaining", { exact: false })).toBeVisible();
  await expect(page.getByText("Seat-safe advice only.")).toBeVisible();

  const amount = page.getByLabel("Raise amount", { exact: false });
  await expect(amount).toHaveValue("8");
  await amount.fill("");
  await expect(amount).toHaveValue("");
  await amount.fill("1");
  await amount.press("Enter");
  await expect(page.getByText("Minimum is 8 chips.")).toBeVisible();
  await expect(amount).toHaveValue("1");
  expect(actionBodies).toHaveLength(0);

  await page.getByRole("button", { name: "Max", exact: true }).click();
  await expect(amount).toHaveValue("32");
  expect(actionBodies).toHaveLength(0);

  await suggest(page, {
    action: "raise",
    amount: 12,
    confidence: 0.8,
  });
  await expect(page.getByText("Your copilot suggests")).toBeVisible();
  await expect(page.getByText("Raise to 12", { exact: true })).toBeVisible();
  await expect(page.getByText("80% confidence")).toBeVisible();
  expect(actionBodies).toHaveLength(0);

  await suggest(page, { action: "call", confidence: 0.64 });
  await expect(page.locator(".suggestion-action")).toHaveText("Call");
  await expect(page.getByText("64% confidence")).toBeVisible();
  await expect(page.getByText("Raise to 12", { exact: true })).toHaveCount(0);
  expect(actionBodies).toHaveLength(0);

  await page.getByRole("button", { name: "Use Call" }).click();
  await expect(page.getByRole("heading", { name: "You’re out" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recommendation followed" }),
  ).toBeVisible();
  await expect(page.getByText("You confirmed Call.")).toBeVisible();
  await expect(page.locator(".history-recommendation-followed")).toHaveText(
    "followed",
  );
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
    .not.toContain("suggest_action");

  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Hand 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Blinds 1/2", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Recommendation followed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ask your copilot" })).toBeVisible();
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

    await route.fulfill({
      status: 200,
      json: terminalSituationFor(body.action, body.amount),
    });
  });

  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto("/");
  await expect(page.getByText("WebMCP ready")).toBeVisible();
  await suggest(page, { action: "raise", amount: 12, confidence: 0.8 });

  const amount = page.getByLabel("Raise amount", { exact: false });
  await amount.fill("16");
  await page.getByRole("button", { name: "Raise", exact: true }).click();

  await expect(page.getByText("Your copilot suggests")).toBeVisible();
  await expect(page.getByText("Recommendation followed")).toHaveCount(0);
  await expect(page.getByText("You overrode your copilot")).toHaveCount(0);
  expect(actionBodies).toHaveLength(1);

  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You overrode your copilot" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your copilot suggested Raise to 12; you chose Raise to 16."),
  ).toBeVisible();
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
