import { expect, test, type Page } from "@playwright/test";

function eventObjects(fields: string[], rows: unknown[][]) {
  return rows.map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index]])),
  );
}

async function installWebMCPStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, WebMCPTool>();
    const audit = {
      registrations: {} as Record<string, number>,
      aborts: {} as Record<string, number>,
      overlappingRegistrations: [] as string[],
    };
    Object.defineProperty(window, "__pocketWebMCPAudit", {
      configurable: true,
      value: audit,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: WebMCPTool,
          options?: { signal?: AbortSignal },
        ) {
          if (tools.has(tool.name)) {
            audit.overlappingRegistrations.push(tool.name);
          }
          audit.registrations[tool.name] =
            (audit.registrations[tool.name] ?? 0) + 1;
          tools.set(tool.name, tool);
          options?.signal?.addEventListener(
            "abort",
            () => {
              audit.aborts[tool.name] = (audit.aborts[tool.name] ?? 0) + 1;
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
    await expect(page.getByText("tools registered")).toHaveCount(0);
    await expect(page.locator(".copilot-activity")).toHaveCount(0);
  });

  test("refresh and re-entry leave exactly one live registration per tool", async ({
    page,
  }) => {
    await installWebMCPStub(page);
    await page.goto("/play?mode=mock");
    await expect(page.getByText("WebMCP tools ready").first()).toBeVisible();

    const inspect = () =>
      page.evaluate(async () => {
        const tools = await document.modelContext.getTools();
        const current = tools.find(
          (candidate) => candidate.name === "get_current_situation",
        );
        const history = tools.find(
          (candidate) => candidate.name === "get_hand_history",
        );
        if (!current || !history) throw new Error("Read tools are unavailable.");
        return {
          names: tools.map((tool) => tool.name).sort(),
          current: JSON.parse(
            await document.modelContext.executeTool(current, {}),
          ),
          history: JSON.parse(
            await document.modelContext.executeTool(history, {}),
          ),
          audit: (
            window as typeof window & {
              __pocketWebMCPAudit: {
                registrations: Record<string, number>;
                aborts: Record<string, number>;
                overlappingRegistrations: string[];
              };
            }
          ).__pocketWebMCPAudit,
        };
      });

    let snapshot = await inspect();
    expect(snapshot.names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]);
    expect(snapshot.current).toMatchObject({
      contractVersion: 3,
      game: { handId: "hand:8" },
      context: { recentEvents: expect.any(Array) },
    });
    expect(snapshot.history).toMatchObject({
      contractVersion: 3,
      game: { handId: "hand:8" },
      events: expect.any(Array),
    });
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);

    await page.getByRole("button", { name: "Call 32" }).click();
    await expect
      .poll(async () => (await inspect()).names)
      .toEqual([
        "get_current_situation",
        "get_hand_history",
        "stage_recommendation",
      ]);
    snapshot = await inspect();
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);
    expect(snapshot.audit.aborts.stage_recommendation).toBeGreaterThanOrEqual(1);

    await page.getByRole("link", { name: "Pocket home" }).click();
    await expect(
      page.getByRole("heading", { name: "Bring your own AI to the table." }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await document.modelContext.getTools()).map((tool) => tool.name),
      ),
    ).toEqual([]);

    await page.goBack();
    await expect(page.getByText("WebMCP tools ready").first()).toBeVisible();
    snapshot = await inspect();
    expect(snapshot.names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]);
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);

    await page.reload();
    await expect(page.getByText("WebMCP tools ready").first()).toBeVisible();
    snapshot = await inspect();
    expect(snapshot.names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]);
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);
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
        (candidate) => candidate.name === "stage_recommendation",
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
      "stage_recommendation",
    ]);
    expect(browserContract.currentDescription).toContain("authoritative");
    expect(browserContract.currentResult).toMatchObject({
      game: { stateVersion: 17 },
      context: {
        bettingRoundState: "raised",
        isFirstVoluntaryAction: false,
        foldedPlayers: [],
        summary: expect.stringContaining("Alex raised to 44"),
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
          name: "Morgan",
          action: "bet",
          finalStreetTotal: 12,
        }),
        expect.objectContaining({
          name: "Alex",
          action: "raise",
          finalStreetTotal: 44,
        }),
      ]),
    );
    expect(browserContract.currentResult.context.summary).not.toContain(
      "folded",
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
    await expect(page.getByText("Reading the hand…").first()).toBeVisible();
    await page.evaluate(() =>
      (window as typeof window & { __pocketRead: Promise<string> }).__pocketRead,
    );
    await expect(page.getByText("Hand read by your agent").first()).toBeVisible();
    await expect(page.locator(".copilot-activity")).toHaveCount(1);

    const invalid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === "stage_recommendation");
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
    await expect(page.getByRole("heading", { name: "Recommendation rejected" })).toBeVisible();

    const versionBeforeAdvice = await page.locator(".header-game-meta").textContent();
    const valid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === "stage_recommendation");
      if (!tool) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(tool, {
          action: "raise",
          amount: 64,
          stateVersion: 17,
          confidence: 0.72,
          rationale: "Top pair supports a legal value raise.",
        }),
      ) as { ok: boolean };
    });
    expect(valid.ok).toBe(true);
    await expect(page.locator(".copilot-recommendation.is-current")).toBeVisible();
    await expect(page.locator(".suggestion-action")).toHaveText("Raise to 64");
    await expect(page.getByText("Top pair supports a legal value raise.")).toBeVisible();
    await expect(page.getByText("Suggestion only — no action taken.")).toBeVisible();
    await expect(page.getByText("Recommendation staged")).toBeVisible();
    const amount = page.getByRole("spinbutton", { name: "Raise to", exact: true });
    await expect(amount).toHaveValue("64");
    const raiseButton = page.getByRole("button", { name: "Raise to 64", exact: true });
    await expect(raiseButton).toHaveAttribute("data-recommended", "true");
    await expect(raiseButton.getByText("Agent pick")).toBeVisible();
    await amount.fill("65");
    await expect(
      page.getByRole("button", { name: "Raise to 65", exact: true }),
    ).not.toHaveAttribute("data-recommended", "true");
    await expect(page.locator(".copilot-recommendation.is-current")).toBeVisible();

    const passive = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
      if (!tool) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(tool, {
          action: "call",
          stateVersion: 17,
        }),
      ) as { ok: boolean };
    });
    expect(passive.ok).toBe(true);
    await expect(amount).toHaveValue("65");
    await expect(
      page.getByRole("button", { name: "Call 32", exact: true }),
    ).toHaveAttribute("data-recommended", "true");
    await expect(page.locator(".header-game-meta")).toHaveText(versionBeforeAdvice ?? "");
  });

  test("keeps the latest actions in the rail and legal mechanics in the dock", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");

    const trail = page.locator(".hand-feed > .hand-feed-groups .hand-feed-item");
    await expect(trail).toHaveCount(2);
    await expect(trail.nth(0)).toContainText("You bet 12");
    await expect(trail.nth(1)).toContainText("Alex raises to 44");
    await expect(trail.nth(1)).toContainText("Latest");
    await expect(trail.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".hand-feed-previous")).toContainText(
      "Preflop3 actions",
    );
    const preflopDisclosure = page.getByRole("button", {
      name: "Preflop 3 actions",
    });
    await preflopDisclosure.click();
    await expect(preflopDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(".hand-feed-previous-actions .hand-feed-item"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toHaveCount(0);

    await expect(
      page
        .locator(".decision-metrics div")
        .filter({ hasText: "Pot" })
        .locator("dd"),
    ).toHaveText("68");
    await expect(
      page
        .locator(".decision-metrics div")
        .filter({ hasText: "To call" })
        .locator("dd"),
    ).toHaveText("32");
    await expect(
      page.locator('.seat-1 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText("Raise to 44");
    await expect(
      page.locator('.seat-0 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText("Your turn");

    const latestHistory = page.locator(".hand-feed-item.is-latest");
    await expect(latestHistory).toContainText("Latest");
    await expect(latestHistory).toContainText("Alex raises to 44");
    await page.getByRole("button", { name: "Full history", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toBeVisible();
    await expect(page.locator(".history-dialog .hand-feed-item")).toHaveCount(5);
    const dialogOwnsCardOverlap = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".history-dialog");
      if (!dialog) return false;

      const dialogRect = dialog.getBoundingClientRect();
      const overlappingCard = Array.from(
        document.querySelectorAll<HTMLElement>(".playing-card"),
      ).find((card) => {
        const cardRect = card.getBoundingClientRect();
        return (
          Math.max(dialogRect.left, cardRect.left) <
            Math.min(dialogRect.right, cardRect.right) &&
          Math.max(dialogRect.top, cardRect.top) <
            Math.min(dialogRect.bottom, cardRect.bottom)
        );
      });
      if (!overlappingCard) return false;

      const cardRect = overlappingCard.getBoundingClientRect();
      const intersectionLeft = Math.max(dialogRect.left, cardRect.left);
      const intersectionRight = Math.min(dialogRect.right, cardRect.right);
      const intersectionTop = Math.max(dialogRect.top, cardRect.top);
      const intersectionBottom = Math.min(dialogRect.bottom, cardRect.bottom);
      const topElement = document.elementFromPoint(
        (intersectionLeft + intersectionRight) / 2,
        (intersectionTop + intersectionBottom) / 2,
      );

      return topElement ? dialog.contains(topElement) : false;
    });
    expect(dialogOwnsCardOverlap).toBe(true);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toHaveCount(0);
    await expect(page.getByText("The table is live.")).toHaveCount(0);

    await page.getByRole("button", { name: "Call 32" }).click();
    await expect(page.locator(".decision-notice")).toContainText(
      "Action sent",
    );
    await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
      "You call 32",
    );
    await expect(page.locator(".seat-1 .seat-action-cue")).toContainText(
      "Call 32",
      { timeout: 3_000 },
    );
    await expect(
      page
        .locator(".decision-metrics div")
        .filter({ hasText: "To call" })
        .locator("dd"),
    ).toHaveText("0");
    await expect(page.locator(".seat-0 .seat-action-cue")).toContainText(
      "Your turn",
    );
  });

  test("keeps every raise control synchronized with the submitted final total", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");

    const amount = page.getByRole("spinbutton", {
      name: "Raise to",
      exact: true,
    });
    const action = (value: number) =>
      page.getByRole("button", { name: `Raise to ${value}`, exact: true });

    await expect(amount).toHaveValue("64");
    await expect(action(64)).toBeVisible();
    await expect(
      page.getByText("Min 64 · Max 184", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "½ pot: 94", exact: true }).click();
    await expect(amount).toHaveValue("94");
    await expect(action(94)).toBeVisible();

    await page.getByRole("button", { name: "Pot: 144", exact: true }).click();
    await expect(amount).toHaveValue("144");
    await expect(action(144)).toBeVisible();

    await page.getByRole("button", { name: "All-in: 184", exact: true }).click();
    await expect(amount).toHaveValue("184");
    await expect(action(184)).toBeVisible();

    await amount.fill("128");
    await expect(action(128)).toBeVisible();
    await amount.fill("999");
    await expect(amount).toHaveValue("184");
    await expect(action(184)).toBeVisible();

    await amount.fill("1");
    await amount.blur();
    await expect(amount).toHaveValue("64");
    await page.getByRole("button", { name: "Min: 64", exact: true }).click();

    const slider = page.getByRole("slider", { name: "Raise to slider" });
    await slider.evaluate((element: HTMLInputElement) => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(element, "120");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(amount).toHaveValue("120");
    await expect(action(120)).toBeVisible();

    await action(120).click();
    await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
      "You raise to 120",
    );
  });

  for (const viewport of [
    { label: "split screen", width: 880, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    test(`${viewport.label} keeps activity and actions inside the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(
        page
          .locator(".decision-metrics div")
          .filter({ hasText: "To call" })
          .locator("dd"),
      ).toHaveText("32");
      await expect(page.getByRole("button", { name: "Call 32" })).toBeVisible();
      await expect(page.locator(".companion-rail-toggle")).toBeVisible();
      await page.locator(".companion-rail-toggle").click();
      await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
        "Alex raises to 44",
      );

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
