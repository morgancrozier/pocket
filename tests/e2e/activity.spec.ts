import { expect, test, type Page } from "@playwright/test";

async function installWebMCPStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, WebMCPTool>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: WebMCPTool,
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
        async executeTool(tool: WebMCPTool, input: Record<string, unknown>) {
          const registered = tools.get(tool.name);
          if (!registered) throw new Error(`Tool ${tool.name} is unavailable.`);
          return registered.execute(input);
        },
      },
    });
  });
}

test.describe("in-game activity clarity", () => {
  test("shows an unavailable copilot truthfully without inventing activity", async ({
    page,
  }) => {
    await page.goto("/play?mode=mock");

    await expect(page.getByText("WebMCP unavailable").first()).toBeVisible();
    await expect(page.getByText("Seat-safe connection")).toHaveCount(0);
    await expect(page.locator(".copilot-activity li")).toHaveCount(0);
  });

  test("renders real reading, rejection, and recommendation receipts without playing", async ({
    page,
  }) => {
    await installWebMCPStub(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");
    await expect(page.getByText("WebMCP tools ready").first()).toBeVisible();

    const browserContract = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const current = tools.find(
        (candidate) => candidate.name === "get_current_situation",
      );
      const suggestion = tools.find(
        (candidate) => candidate.name === "suggest_action",
      );
      if (!current || !suggestion) {
        throw new Error("Expected WebMCP tools are unavailable.");
      }
      return {
        names: tools.map((tool) => tool.name).sort(),
        currentDescription: current.description,
        currentResult: JSON.parse(
          await document.modelContext.executeTool(current, {}),
        ),
        suggestionDescription: suggestion.description,
        suggestionInputSchema: suggestion.inputSchema,
      };
    });
    expect(browserContract.names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "suggest_action",
    ]);
    expect(browserContract.currentDescription).toContain("authoritative");
    expect(browserContract.currentResult).toMatchObject({
      stateVersion: 17,
      actionContext: {
        bettingRoundState: "raised",
        isFirstVoluntaryAction: false,
        nextToAct: {
          playerId: "hero",
          playerName: "Morgan",
          isYou: true,
        },
        voluntaryActionsThisStreet: [
          { playerName: "Morgan", action: "bet", amount: 12 },
          { playerName: "Alex", action: "raise", amount: 44 },
        ],
        foldedPlayers: [],
      },
      situationSummary: expect.stringContaining("Alex raised to 44"),
    });
    expect(browserContract.currentResult.situationSummary).not.toContain(
      "folded",
    );
    expect(browserContract.suggestionDescription).toContain("never plays");
    expect(browserContract.suggestionInputSchema).toMatchObject({
      required: ["action", "stateVersion"],
      properties: {
        stateVersion: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    });

    const initialVersion = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("pocket-agent-suggestion") ?? "null"),
    );
    expect(initialVersion).toBeNull();

    await page.evaluate(() => {
      const browserWindow = window as typeof window & {
        __pocketRead?: Promise<string>;
      };
      const originalFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 180);
      browserWindow.__pocketRead = (async () => {
        const tools = await document.modelContext.getTools();
        const tool = tools.find(
          (candidate) => candidate.name === "get_current_situation",
        );
        if (!tool) throw new Error("Current-situation tool is unavailable.");
        return document.modelContext.executeTool(tool, {});
      })().finally(() => {
        window.requestAnimationFrame = originalFrame;
      });
    });
    await expect(page.getByRole("heading", { name: "Reading current hand" })).toBeVisible();
    await page.evaluate(() =>
      (window as typeof window & { __pocketRead: Promise<string> }).__pocketRead,
    );
    await expect(page.getByText("Read current hand").first()).toBeVisible();

    const invalid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === "suggest_action");
      if (!tool) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(tool, {
          action: "raise",
          amount: 7,
          stateVersion: 17,
        }),
      ) as { ok: boolean; error?: { code?: string } };
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "INVALID_AMOUNT" },
    });
    await expect(page.getByRole("heading", { name: "Suggestion rejected" })).toBeVisible();

    const versionBeforeAdvice = await page.locator(".header-game-meta").textContent();
    const valid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === "suggest_action");
      if (!tool) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(tool, {
          action: "raise",
          amount: 64,
          stateVersion: 17,
          confidence: 0.72,
        }),
      ) as { ok: boolean };
    });
    expect(valid.ok).toBe(true);
    await expect(page.getByRole("heading", { name: "Your copilot suggests" })).toBeVisible();
    await expect(page.locator(".suggestion-action")).toHaveText("Raise to 64");
    await expect(page.getByText("Returned recommendation")).toBeVisible();
    await expect(page.locator(".header-game-meta")).toHaveText(versionBeforeAdvice ?? "");
  });

  test("keeps the latest actions in the rail and legal mechanics in the dock", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");

    const trail = page.locator(".hand-feed-item");
    await expect(trail).toHaveCount(5);
    await expect(trail.nth(2)).toContainText("You called 6");
    await expect(trail.nth(3)).toContainText("You bet 12");
    await expect(trail.nth(4)).toContainText("Alex raised to 44");
    await expect(trail.nth(4)).toContainText("Latest");
    await expect(trail.nth(4)).toHaveAttribute("aria-current", "true");

    await expect(page.locator(".decision-summary")).toHaveText(
      "Alex raised to 44·Pot 68·32 to call",
    );
    await expect(
      page.locator('.seat-1 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText(
      "Raised to 44",
    );
    await expect(
      page.locator('.seat-0 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText("In 12");

    const latestHistory = page.locator(".hand-feed-item.is-latest");
    await expect(latestHistory).toContainText("Latest");
    await expect(latestHistory).toContainText("Alex raised to 44");
    await page.getByRole("button", { name: "Full hand history" }).click();
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toBeVisible();
    await expect(page.locator(".history-dialog .hand-feed-item")).toHaveCount(5);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toHaveCount(0);
    await expect(page.getByText("The table is live.")).toHaveCount(0);

    await page.getByRole("button", { name: "Call 32" }).click();
    await expect(page.locator(".decision-notice")).toContainText(
      "You chose call 32",
    );
    await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
      "You called 32",
    );
    await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
      "Alex called 32",
      { timeout: 3_000 },
    );
    await expect(page.locator(".decision-summary")).toContainText(
      "Check available",
    );
    await expect(page.locator(".seat-action-cue")).toHaveCount(0);
  });

  for (const viewport of [
    { label: "split screen", width: 960, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    test(`${viewport.label} keeps activity and actions inside the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(page.locator(".decision-summary")).toContainText(
        "Alex raised to 44",
      );
      await expect(page.getByRole("button", { name: "Call 32" })).toBeVisible();
      await expect(page.locator(".companion-rail-toggle")).toBeVisible();
      await page.locator(".companion-rail-toggle").click();
      await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
        "Alex raised to 44",
      );

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
