import { expect, test, type Page } from "@playwright/test";
import { INITIAL_SITUATION } from "../../src/lib/poker/mock-state";

async function installWebMCPStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, { name: string }>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool: { name: string }, options?: { signal?: AbortSignal }) {
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
      },
    });
  });
}

test("the choice-first launcher stays idle and preserves setup drafts", async ({
  page,
}) => {
  await installWebMCPStub(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pocket" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bring your own AI to the table." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Play with Bots/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Host a Game/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Join with a Code/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "About Pocket" })).toBeVisible();
  await expect(page.locator(".game-shell, .poker-table")).toHaveCount(0);
  expect(
    await page.evaluate(async () =>
      (await document.modelContext.getTools()).map((tool) => tool.name),
    ),
  ).toEqual([]);
  expect(requests.some((url) => url.includes("/api/games/demo/"))).toBe(false);
  expect(requests.some((url) => url.includes("/api/rooms"))).toBe(false);
  expect(requests.some((url) => url.includes("/auth/v1/signup"))).toBe(false);

  const hostTrigger = page.getByRole("button", { name: /Host a Game/ });
  const joinTrigger = page.getByRole("button", { name: /Join with a Code/ });
  await hostTrigger.click();
  await expect(hostTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#host-display-name")).toBeFocused();
  await page.locator("#host-display-name").fill("Morgan");

  await joinTrigger.click();
  await expect(joinTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#host-display-name")).toHaveCount(0);
  await expect(page.locator("#join-room-code")).toBeFocused();
  await page.locator("#join-room-code").fill("abcd-2345");
  await page.locator("#join-display-name-home").fill("Alex");

  await hostTrigger.click();
  await expect(page.locator("#host-display-name")).toBeFocused();
  await expect(page.locator("#host-display-name")).toHaveValue("Morgan");
  await joinTrigger.click();
  await expect(page.locator("#join-room-code")).toBeFocused();
  await expect(page.locator("#join-room-code")).toHaveValue("abcd-2345");
  await expect(page.locator("#join-display-name-home")).toHaveValue("Alex");

  await page.locator("#join-room-code").fill("NOPE");
  await page.getByRole("button", { name: "Join table" }).click();
  await expect(
    page.getByText("Enter a valid eight-character room code or invite link."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(requests.some((url) => url.includes("/auth/v1/signup"))).toBe(false);

  await joinTrigger.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: /Play with Bots/ })).toBeVisible();
  await expect(hostTrigger).toBeVisible();
  await expect(joinTrigger).toBeVisible();
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});

test("the About page explains WebMCP without initializing a seat", async ({
  page,
}) => {
  await installWebMCPStub(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "About Pocket" }).click();

  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Every seat has two minds.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Useful access. Deliberate limits." }),
  ).toBeVisible();
  await expect(page.getByText("No poker execution tools.")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Poker is the environment. Agent-native interaction is the experiment.",
    }),
  ).toBeVisible();
  await expect(page.locator(".game-shell, .poker-table")).toHaveCount(0);
  expect(
    await page.evaluate(async () =>
      (await document.modelContext.getTools()).map((tool) => tool.name),
    ),
  ).toEqual([]);
  expect(requests.some((url) => url.includes("/api/games/demo/"))).toBe(false);
  expect(requests.some((url) => url.includes("/api/rooms"))).toBe(false);
  expect(requests.some((url) => url.includes("/auth/v1/signup"))).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
  await expect(page.getByRole("link", { name: "Play with bots" }).last()).toBeVisible();
});

test("Play with Bots opens the prepared judge tournament route", async ({ page }) => {
  await page.route("**/api/games/demo/state**", (route) =>
    route.fulfill({ status: 200, json: INITIAL_SITUATION }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: /Play with Bots/ }).click();
  await expect(page).toHaveURL(
    /\/play\?demo=judge&run=[0-9a-f-]{36}$/,
  );
  const firstJudgeRun = page.url();
  await expect(page.getByRole("heading", { name: "Pocket" })).toBeVisible();
  await expect(page.locator(".poker-table")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(firstJudgeRun);
  await page.getByRole("link", { name: "Pocket home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /Play with Bots/ }).click();
  await expect(page).toHaveURL(
    /\/play\?demo=judge&run=[0-9a-f-]{36}$/,
  );
  expect(page.url()).not.toBe(firstJudgeRun);
  await page.getByRole("link", { name: "Pocket home" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your own AI to the table." }),
  ).toBeVisible();
});

test("legacy mock and debug links redirect to the play route", async ({ page }) => {
  await page.goto("/?mode=mock&debug=1");
  await expect(page).toHaveURL(/\/play\?mode=mock&debug=1$/);
  await expect(page.getByRole("heading", { name: "Pocket" })).toBeVisible();
  await expect(page.getByText("Development spike controls")).toBeVisible();
});
