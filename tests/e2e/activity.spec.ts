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
      identities: {} as Record<string, number>,
      toolChanges: 0,
    };
    const toolIds = new WeakMap<WebMCPTool, number>();
    let nextToolId = 1;
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

  test("gameplay keeps one stable registration per tool until the table unmounts", async ({
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
        if (!current || !history)
          throw new Error("Read tools are unavailable.");
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
                identities: Record<string, number>;
                toolChanges: number;
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
    for (const name of [
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]) {
      expect(snapshot.audit.registrations[name]).toBeGreaterThanOrEqual(1);
    }
    const initialRegistrations = snapshot.audit.registrations;
    const initialAborts = snapshot.audit.aborts;
    const initialToolChanges = snapshot.audit.toolChanges;
    const initialIdentities = snapshot.audit.identities;

    const staged = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const suggestion = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
      if (!suggestion) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(suggestion, {
          action: "call",
          stateVersion: 17,
        }),
      ) as { ok: boolean };
    });
    expect(staged.ok).toBe(true);
    await expect(
      page.locator(".copilot-recommendation.is-current"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(
      page.locator(".copilot-recommendation.is-current"),
    ).toHaveCount(0);
    snapshot = await inspect();
    expect(snapshot.audit.registrations).toEqual(initialRegistrations);
    expect(snapshot.audit.aborts).toEqual(initialAborts);
    expect(snapshot.audit.identities).toEqual(initialIdentities);
    expect(snapshot.audit.toolChanges).toBe(initialToolChanges);

    await page.getByRole("button", { name: "Call 32" }).click();
    await expect(
      page.getByRole("heading", { name: "Alex is acting" }),
    ).toBeVisible();
    const opponentTurn = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const current = tools.find(
        (candidate) => candidate.name === "get_current_situation",
      );
      const suggestion = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
      if (!current || !suggestion)
        throw new Error("WebMCP tools are unavailable.");
      const situation = JSON.parse(
        await document.modelContext.executeTool(current, {}),
      ) as { game: { stateVersion: number } };
      return JSON.parse(
        await document.modelContext.executeTool(suggestion, {
          action: "check",
          stateVersion: situation.game.stateVersion,
        }),
      ) as { ok: boolean; error?: { code?: string } };
    });
    expect(opponentTurn).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
    await expect
      .poll(async () => (await inspect()).names)
      .toEqual([
        "get_current_situation",
        "get_hand_history",
        "stage_recommendation",
      ]);
    await expect(
      page.getByRole("heading", { name: "Your turn" }),
    ).toBeVisible();
    snapshot = await inspect();
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);
    expect(snapshot.audit.registrations).toEqual(initialRegistrations);
    expect(snapshot.audit.aborts).toEqual(initialAborts);
    expect(snapshot.audit.identities).toEqual(initialIdentities);
    expect(snapshot.audit.toolChanges).toBe(initialToolChanges);

    const stale = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const suggestion = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
      if (!suggestion) throw new Error("Suggestion tool is unavailable.");
      return JSON.parse(
        await document.modelContext.executeTool(suggestion, {
          action: "call",
          stateVersion: 17,
        }),
      ) as { ok: boolean; error?: { code?: string } };
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "STALE_STATE" },
    });
    snapshot = await inspect();
    expect(snapshot.audit.registrations).toEqual(initialRegistrations);
    expect(snapshot.audit.aborts).toEqual(initialAborts);
    expect(snapshot.audit.identities).toEqual(initialIdentities);
    expect(snapshot.audit.toolChanges).toBe(initialToolChanges);

    await page.getByRole("link", { name: "Pocket home" }).click();
    await expect(
      page.getByRole("heading", { name: "Bring your own AI to the table." }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await document.modelContext.getTools()).map((tool) => tool.name),
      ),
    ).toEqual([]);
    const unmountedAudit = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __pocketWebMCPAudit: {
              aborts: Record<string, number>;
              toolChanges: number;
            };
          }
        ).__pocketWebMCPAudit,
    );
    for (const name of [
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]) {
      expect(unmountedAudit.aborts[name]).toBe((initialAborts[name] ?? 0) + 1);
    }
    expect(unmountedAudit.toolChanges).toBe(initialToolChanges + 3);

    await page.goBack();
    await expect(page.getByText("WebMCP tools ready").first()).toBeVisible();
    snapshot = await inspect();
    expect(snapshot.names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]);
    expect(snapshot.audit.overlappingRegistrations).toEqual([]);
    for (const name of [
      "get_current_situation",
      "get_hand_history",
      "stage_recommendation",
    ]) {
      expect(snapshot.audit.registrations[name]).toBeGreaterThan(
        initialRegistrations[name] ?? 0,
      );
    }

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
    await page.evaluate(
      () =>
        (window as typeof window & { __pocketRead: Promise<string> })
          .__pocketRead,
    );
    const readActivity = page
      .locator(".webmcp-activity-list li")
      .filter({ hasText: "get_current_situation" })
      .last();
    await expect(readActivity).toBeVisible();
    await expect(readActivity).toContainText(
      "Hand 8 · Flop · state v17 · seat-safe",
    );
    await expect(page.locator(".copilot-activity")).toHaveCount(0);

    const invalid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
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
    await expect(
      page.getByRole("heading", { name: "Recommendation rejected" }),
    ).toBeVisible();

    const versionBeforeAdvice = await page
      .locator(".header-game-meta")
      .textContent();
    const valid = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(
        (candidate) => candidate.name === "stage_recommendation",
      );
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
    await expect(
      page.locator(".copilot-recommendation.is-current"),
    ).toBeVisible();
    await expect(
      page
        .locator(".webmcp-activity-list li")
        .filter({ hasText: "stage_recommendation" })
        .last(),
    ).toContainText("state v17 → Raise to 64");
    await expect(page.locator(".suggestion-action")).toHaveText("Raise to 64");
    await expect(
      page.getByText("Top pair supports a legal value raise."),
    ).toBeVisible();
    await expect(
      page.getByText("Suggestion only — no action taken."),
    ).toBeVisible();
    await expect(page.getByText("Recommendation staged")).toHaveCount(0);
    await expect(page.getByText("72% confidence")).toHaveCount(0);
    const sizingTrigger = page.getByRole("button", {
      name: "Raise to…",
      exact: true,
    });
    await sizingTrigger.click();
    const amount = page.getByRole("spinbutton", {
      name: "Raise to",
      exact: true,
    });
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue("64");
    const raiseButton = page.getByRole("button", {
      name: "Raise to 64",
      exact: true,
    });
    await expect(raiseButton).toHaveAttribute("data-recommended", "true");
    await expect(raiseButton.getByText("Agent pick")).toBeVisible();
    await amount.fill("65");
    await expect(
      page.getByRole("button", { name: "Raise to 65", exact: true }),
    ).not.toHaveAttribute("data-recommended", "true");
    await expect(
      page.locator(".copilot-recommendation.is-current"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sizingTrigger).toBeFocused();

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
    await expect(
      page.getByRole("button", { name: "Call 32", exact: true }),
    ).toHaveAttribute("data-recommended", "true");
    await page.getByRole("button", { name: "Raise to…", exact: true }).click();
    await expect(amount).toHaveValue("65");
    await expect(page.locator(".header-game-meta")).toHaveText(
      versionBeforeAdvice ?? "",
    );
  });

  test("keeps the latest actions in the rail and legal mechanics in the dock", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");

    const trail = page.locator(
      ".hand-feed > .hand-feed-groups .hand-feed-item",
    );
    await expect(trail).toHaveCount(5);
    await expect(trail.nth(0)).toContainText("You call 2");
    await expect(trail.nth(3)).toContainText("You bet 12");
    await expect(trail.nth(4)).toContainText("Alex raises to 44");
    await expect(trail.nth(4)).toContainText("Latest");
    await expect(trail.nth(4)).toHaveAttribute("aria-current", "true");
    await expect(
      page.locator(".hand-feed-previous-group").first().locator("summary"),
    ).toContainText("Preflop");
    await expect(
      page.locator(".hand-feed-previous-group").first().locator("summary"),
    ).toContainText("3 actions");
    await expect(
      page.locator(".hand-feed-group.is-current").getByRole("heading"),
    ).toHaveText("Flop");
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
    await page
      .getByRole("button", { name: "Full history", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Full hand history" }),
    ).toBeVisible();
    await expect(page.locator(".history-dialog .hand-feed-item")).toHaveCount(
      5,
    );
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
    await expect(page.locator(".decision-notice")).toContainText("Action sent");
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

    await expect(amount).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await page.getByRole("button", { name: "Raise to…", exact: true }).click();
    await expect(page.getByRole("slider")).toHaveCount(0);
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

    await page
      .getByRole("button", { name: "All-in: 184", exact: true })
      .click();
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

    const decrement = page.getByRole("button", {
      name: "Decrease raise to amount",
    });
    const increment = page.getByRole("button", {
      name: "Increase raise to amount",
    });
    await expect(decrement).toBeDisabled();
    await increment.click();
    await expect(amount).toHaveValue("65");
    await decrement.click();
    await expect(amount).toHaveValue("64");

    await amount.fill("120");
    await expect(amount).toHaveValue("120");
    await expect(action(120)).toBeVisible();

    await action(120).click();
    await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
      "You raise to 120",
    );
  });

  for (const viewport of [
    { label: "narrow judge short", width: 831, height: 900, isCompact: true },
    { label: "split screen", width: 900, height: 900, isCompact: true },
    { label: "former breakpoint", width: 1001, height: 900, isCompact: true },
    { label: "compact edge", width: 1100, height: 900, isCompact: true },
    { label: "wide rail edge", width: 1101, height: 900, isCompact: false },
    { label: "mobile", width: 390, height: 844, isCompact: false },
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
      await expect(page.locator(".private-copilot")).toBeVisible();
      await expect(page.locator(".hand-feed")).toBeVisible();
      const compactHistory = page.getByRole("button", {
        name: "Open current hand history",
      });
      if (viewport.isCompact) {
        await expect(compactHistory).toBeVisible();
        await expect(page.locator(".hand-feed-item.is-latest")).toBeHidden();
      } else {
        await expect(compactHistory).toHaveCount(0);
        await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
          "Alex raises to 44",
        );
      }

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }

  for (const viewport of [
    { label: "minimum phone", width: 320, height: 568 },
    { label: "small phone", width: 375, height: 667 },
    { label: "standard phone", width: 390, height: 844 },
    { label: "state-board upper edge", width: 430, height: 844 },
  ]) {
    test(`${viewport.label} presents a readable table-free state board`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(
        page.locator('.poker-table[data-street="flop"]'),
      ).toBeVisible();
      await expect(
        page.locator(".community-cards .playing-card:not(.is-empty-slot)"),
      ).toHaveCount(3);
      await expect(
        page.locator(".community-cards .playing-card.is-empty-slot"),
      ).toHaveCount(2);

      const geometry = await page.evaluate(() => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        };
        const required = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return element;
        };
        const intersects = (
          left: ReturnType<typeof rect>,
          right: ReturnType<typeof rect>,
        ) =>
          Math.max(left.left, right.left) <
            Math.min(left.right, right.right) - 1 &&
          Math.max(left.top, right.top) <
            Math.min(left.bottom, right.bottom) - 1;

        const stage = rect(required(".table-stage"));
        const tableElement = required(".poker-table");
        const table = rect(tableElement);
        const board = rect(required(".table-center"));
        const opponentRoster = required(".opponent-roster");
        const opponentSeats = Array.from(
          opponentRoster.querySelectorAll(".player-seat"),
        );
        const seats = Array.from(document.querySelectorAll(".player-seat")).map(
          (seat) => ({
            seat: rect(seat),
            cards: seat.querySelector(".seat-cards"),
            panel: seat.querySelector(".seat-panel"),
            chips: seat.querySelector(".committed-chips"),
          }),
        );
        const communityCards = Array.from(
          document.querySelectorAll(".community-cards .playing-card"),
        ).map(rect);
        const heroCards = Array.from(
          document.querySelectorAll(
            '.player-seat[data-local="true"] .playing-card',
          ),
        ).map(rect);
        const actionButtons = Array.from(
          document.querySelectorAll(".human-action-dock .action-button"),
        ).map(rect);
        const hero = rect(required('.player-seat[data-local="true"]'));
        const heroPanel = rect(
          required('.player-seat[data-local="true"] .seat-panel'),
        );
        const dealer = document.querySelector(
          '.player-seat[data-local="true"] .dealer-chip',
        );
        const actionDock = rect(required(".human-action-dock"));
        const streetLabel = rect(required(".table-street-label"));
        const pot = rect(required(".pot-label"));
        const tableStyle = getComputedStyle(tableElement);
        const opponentPanelLefts = opponentSeats.map((seat) => {
          const panel = seat.querySelector(".seat-panel");
          if (!panel) throw new Error("Missing opponent seat panel");
          return rect(panel).left;
        });

        return {
          stage,
          table,
          tableDisplay: tableStyle.display,
          tableBorderWidth: tableStyle.borderTopWidth,
          layoutOrder: Array.from(tableElement.children).map((element) => {
            if (element.classList.contains("table-center")) return "board";
            if (element.classList.contains("opponent-roster")) {
              return "opponents";
            }
            if (element.matches('.player-seat[data-local="true"]')) {
              return "hero";
            }
            return "unexpected";
          }),
          opponentNames: opponentSeats.map(
            (seat) =>
              seat.querySelector(".seat-name > span:first-child")?.textContent,
          ),
          opponentVisualOrder: opponentSeats.every((seat, index) => {
            const next = opponentSeats[index + 1];
            return !next || rect(seat).bottom <= rect(next).top + 1;
          }),
          opponentPanelLeftSpread:
            Math.max(...opponentPanelLefts) - Math.min(...opponentPanelLefts),
          boardHeaderCenterDifference: Math.abs(
            streetLabel.top +
              streetLabel.height / 2 -
              (pot.top + pot.height / 2),
          ),
          heroBeforeActions: hero.bottom <= actionDock.top,
          dealerInsideHeroPanel:
            !dealer ||
            (rect(dealer).left >= heroPanel.left - 1 &&
              rect(dealer).right <= heroPanel.right + 1 &&
              rect(dealer).top >= heroPanel.top - 1 &&
              rect(dealer).bottom <= heroPanel.bottom + 1),
          opponentRosterDisplay: getComputedStyle(opponentRoster).display,
          boardSeatOverlap: seats.some(({ seat }) => intersects(board, seat)),
          seatOverlap: seats.some(({ seat }, index) =>
            seats.some(
              ({ seat: other }, otherIndex) =>
                index < otherIndex && intersects(seat, other),
            ),
          ),
          seatCardsPanelOverlap: seats.some(
            ({ cards, panel }) =>
              cards && panel && intersects(rect(cards), rect(panel)),
          ),
          chipsOutsideSeat: seats.some(
            ({ seat, chips }) =>
              chips &&
              (rect(chips).left < seat.left - 1 ||
                rect(chips).right > seat.right + 1 ||
                rect(chips).top < seat.top - 1 ||
                rect(chips).bottom > seat.bottom + 1),
          ),
          seatsInsideStage: seats.every(
            ({ seat }) =>
              seat.top >= stage.top - 1 &&
              seat.right <= stage.right + 1 &&
              seat.bottom <= stage.bottom + 1 &&
              seat.left >= stage.left - 1,
          ),
          minCommunityWidth: Math.min(
            ...communityCards.map((card) => card.width),
          ),
          minCommunityHeight: Math.min(
            ...communityCards.map((card) => card.height),
          ),
          minHeroWidth: Math.min(...heroCards.map((card) => card.width)),
          minHeroHeight: Math.min(...heroCards.map((card) => card.height)),
          minActionHeight: Math.min(
            ...actionButtons.map((button) => button.height),
          ),
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(geometry.tableDisplay).toBe("grid");
      expect(geometry.tableBorderWidth).toBe("0px");
      expect(geometry.layoutOrder).toEqual(["board", "opponents", "hero"]);
      expect(geometry.opponentNames).toEqual(["Alex", "June", "Theo"]);
      expect(geometry.opponentVisualOrder).toBe(true);
      expect(geometry.opponentPanelLeftSpread).toBeLessThanOrEqual(1);
      expect(geometry.boardHeaderCenterDifference).toBeLessThanOrEqual(1);
      expect(geometry.heroBeforeActions).toBe(true);
      expect(geometry.dealerInsideHeroPanel).toBe(true);
      expect(geometry.opponentRosterDisplay).toBe("grid");
      expect(geometry.stage.height).toBeGreaterThanOrEqual(420);
      expect(geometry.boardSeatOverlap).toBe(false);
      expect(geometry.seatOverlap).toBe(false);
      expect(geometry.seatCardsPanelOverlap).toBe(false);
      expect(geometry.chipsOutsideSeat).toBe(false);
      expect(geometry.seatsInsideStage).toBe(true);
      expect(geometry.table.left).toBeGreaterThanOrEqual(geometry.stage.left);
      expect(geometry.table.right).toBeLessThanOrEqual(geometry.stage.right);
      expect(geometry.table.top).toBeGreaterThanOrEqual(geometry.stage.top);
      expect(geometry.table.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
      expect(geometry.minCommunityWidth).toBeGreaterThanOrEqual(33.5);
      expect(geometry.minCommunityHeight).toBeGreaterThanOrEqual(50.5);
      expect(geometry.minHeroWidth).toBeGreaterThanOrEqual(43.5);
      expect(geometry.minHeroHeight).toBeGreaterThanOrEqual(63.5);
      expect(geometry.minActionHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.hasHorizontalOverflow).toBe(false);
    });
  }

  for (const viewport of [
    { label: "compact felt lower edge", width: 431, height: 844 },
    { label: "compact felt midpoint", width: 474, height: 844 },
    { label: "compact felt upper edge", width: 540, height: 900 },
  ]) {
    test(`${viewport.label} keeps the oval table and capsules separated`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(
        page.locator('.poker-table[data-street="flop"]'),
      ).toBeVisible();

      const geometry = await page.evaluate(() => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        };
        const required = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return element;
        };
        const intersects = (
          left: ReturnType<typeof rect>,
          right: ReturnType<typeof rect>,
        ) =>
          Math.max(left.left, right.left) <
            Math.min(left.right, right.right) - 1 &&
          Math.max(left.top, right.top) <
            Math.min(left.bottom, right.bottom) - 1;

        const stage = rect(required(".table-stage"));
        const table = rect(required(".poker-table"));
        const community = rect(required(".community-cards"));
        const heroCards = rect(
          required('.player-seat[data-local="true"] .seat-cards'),
        );
        const pot = rect(required(".pot-label"));
        const opponentParts = Array.from(
          document.querySelectorAll('.player-seat:not([data-local="true"])'),
        ).map((seat) => ({
          seat: rect(seat),
          cards: seat.querySelector(".seat-cards"),
          panel: seat.querySelector(".seat-panel"),
          chips: seat.querySelector(".committed-chips"),
        }));
        const allSeats = Array.from(
          document.querySelectorAll(".player-seat"),
        ).map(rect);
        const communityCards = Array.from(
          document.querySelectorAll(".community-cards .playing-card"),
        ).map(rect);
        const localCards = Array.from(
          document.querySelectorAll(
            '.player-seat[data-local="true"] .playing-card',
          ),
        ).map(rect);
        const actionButtons = Array.from(
          document.querySelectorAll(".human-action-dock .action-button"),
        ).map(rect);

        return {
          stage,
          table,
          aspectRatio: table.width / table.height,
          communityOpponentOverlap: opponentParts.some(({ seat }) =>
            intersects(community, seat),
          ),
          communityOpponentCardsOverlap: opponentParts.some(
            ({ cards }) => cards && intersects(community, rect(cards)),
          ),
          communityOpponentPanelsOverlap: opponentParts.some(
            ({ panel }) => panel && intersects(community, rect(panel)),
          ),
          communityCommittedChipsOverlap: opponentParts.some(
            ({ chips }) => chips && intersects(community, rect(chips)),
          ),
          opponentCardsPanelOverlap: opponentParts.some(
            ({ cards, panel }) =>
              cards && panel && intersects(rect(cards), rect(panel)),
          ),
          opponentSeatOverlap: opponentParts.some(({ seat }, index) =>
            opponentParts.some(
              ({ seat: other }, otherIndex) =>
                index < otherIndex && intersects(seat, other),
            ),
          ),
          potHeroOverlap: intersects(pot, heroCards),
          seatsInsideStage: allSeats.every(
            (seat) =>
              seat.top >= stage.top - 1 &&
              seat.right <= stage.right + 1 &&
              seat.bottom <= stage.bottom + 1 &&
              seat.left >= stage.left - 1,
          ),
          minCommunityWidth: Math.min(
            ...communityCards.map((card) => card.width),
          ),
          minCommunityHeight: Math.min(
            ...communityCards.map((card) => card.height),
          ),
          minHeroWidth: Math.min(...localCards.map((card) => card.width)),
          minHeroHeight: Math.min(...localCards.map((card) => card.height)),
          minActionHeight: Math.min(
            ...actionButtons.map((button) => button.height),
          ),
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      const expectedStageHeight = Math.min(
        520,
        Math.max(420, viewport.width + 60),
      );
      expect(geometry.aspectRatio).toBeCloseTo(1.2, 2);
      expect(geometry.stage.height).toBeCloseTo(expectedStageHeight, 0);
      expect(geometry.communityOpponentOverlap).toBe(false);
      expect(geometry.communityOpponentCardsOverlap).toBe(false);
      expect(geometry.communityOpponentPanelsOverlap).toBe(false);
      expect(geometry.communityCommittedChipsOverlap).toBe(false);
      expect(geometry.opponentCardsPanelOverlap).toBe(false);
      expect(geometry.opponentSeatOverlap).toBe(false);
      expect(geometry.potHeroOverlap).toBe(false);
      expect(geometry.seatsInsideStage).toBe(true);
      expect(geometry.table.left).toBeGreaterThanOrEqual(geometry.stage.left);
      expect(geometry.table.right).toBeLessThanOrEqual(geometry.stage.right);
      expect(geometry.table.top).toBeGreaterThanOrEqual(geometry.stage.top);
      expect(geometry.table.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
      expect(geometry.minCommunityWidth).toBeGreaterThanOrEqual(33.5);
      expect(geometry.minCommunityHeight).toBeGreaterThanOrEqual(50.5);
      expect(geometry.minHeroWidth).toBeGreaterThanOrEqual(43.5);
      expect(geometry.minHeroHeight).toBeGreaterThanOrEqual(63.5);
      expect(geometry.minActionHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.hasHorizontalOverflow).toBe(false);
    });
  }

  test("541px restores the established mobile table geometry", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 541, height: 900 });
    await page.goto("/play?mode=mock");

    const geometry = await page.evaluate(() => {
      const table = document.querySelector(".poker-table");
      if (!table) throw new Error("Missing poker table");
      const box = table.getBoundingClientRect();
      return {
        aspectRatio: box.width / box.height,
        hasHorizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(geometry.aspectRatio).toBeCloseTo(1.4, 2);
    expect(geometry.hasHorizontalOverflow).toBe(false);
  });

  for (const viewport of [
    { label: "tall desktop", width: 1440, height: 1200, isWide: true },
    { label: "tall split screen", width: 900, height: 1252, isWide: false },
  ]) {
    test(`${viewport.label} uses the available height without clipping the table`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(page.getByRole("button", { name: "Call 32" })).toBeVisible();
      await expect(page.locator(".private-copilot")).toBeVisible();
      await expect(page.locator(".hand-feed")).toBeVisible();

      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        };
        const stage = rect(".table-stage");
        const seats = Array.from(document.querySelectorAll(".player-seat")).map(
          (seat) => {
            const box = seat.getBoundingClientRect();
            return {
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              left: box.left,
            };
          },
        );

        return {
          viewportHeight: window.innerHeight,
          pageBottom: rect("main.page-shell").bottom,
          table: rect(".poker-table"),
          stage,
          dock: rect(".decision-dock"),
          rail: rect(".companion-rail"),
          seats,
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(
        Math.abs(geometry.viewportHeight - geometry.pageBottom),
      ).toBeLessThanOrEqual(48);
      expect(geometry.hasHorizontalOverflow).toBe(false);
      expect(geometry.dock.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.rail.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(
        geometry.seats.every(
          (seat) =>
            seat.top >= geometry.stage.top - 1 &&
            seat.right <= geometry.stage.right + 1 &&
            seat.bottom <= geometry.stage.bottom + 1 &&
            seat.left >= geometry.stage.left - 1,
        ),
      ).toBe(true);

      if (viewport.isWide) {
        expect(geometry.table.height).toBeGreaterThanOrEqual(420);
        expect(geometry.table.height).toBeLessThanOrEqual(520);
      } else {
        expect(geometry.table.width).toBeGreaterThanOrEqual(650);
        expect(geometry.table.width).toBeLessThanOrEqual(761);
        expect(geometry.table.height).toBeGreaterThanOrEqual(350);
        expect(geometry.table.height).toBeLessThanOrEqual(430);
      }
    });
  }

  for (const viewport of [
    { label: "narrow judge view", width: 831, height: 1252 },
    { label: "tall split screen", width: 900, height: 1252 },
    { label: "tall compact edge", width: 1100, height: 1200 },
  ]) {
    test(`${viewport.label} shows inline history without table collisions`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      const historyTrigger = page.getByRole("button", {
        name: "Open current hand history",
      });
      await expect(historyTrigger).toBeHidden();
      await expect(page.locator(".hand-feed-item.is-latest")).toContainText(
        "Alex raises to 44",
      );

      const geometry = await page.evaluate(() => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        };
        const required = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return element;
        };
        const intersects = (
          left: ReturnType<typeof rect>,
          right: ReturnType<typeof rect>,
        ) =>
          Math.max(left.left, right.left) <
            Math.min(left.right, right.right) - 1 &&
          Math.max(left.top, right.top) <
            Math.min(left.bottom, right.bottom) - 1;

        const stage = rect(required(".table-stage"));
        const table = rect(required(".poker-table"));
        const dock = rect(required(".decision-dock"));
        const heroSeat = rect(
          required('.player-seat[data-local="true"]'),
        );
        const seats = Array.from(
          document.querySelectorAll(".player-seat"),
          rect,
        );
        const support = rect(required(".support-panels"));
        const rail = rect(required(".companion-rail"));
        const communityCards = rect(required(".community-cards"));
        const committedChips = Array.from(
          document.querySelectorAll(".committed-chips"),
          rect,
        );
        const pot = rect(required(".pot-label"));
        const localCards = rect(
          required('.player-seat[data-local="true"] .seat-cards'),
        );
        const seatParts = Array.from(
          document.querySelectorAll(".player-seat"),
        ).map((seat) => ({
          cards: seat.querySelector(".seat-cards"),
          panel: seat.querySelector(".seat-panel"),
        }));

        return {
          table,
          stage,
          dock,
          heroSeat,
          seats,
          support,
          rail,
          viewportHeight: window.innerHeight,
          pageBottom: rect(required("main.page-shell")).bottom,
          communityChipsOverlap: committedChips.some((chips) =>
            intersects(communityCards, chips),
          ),
          potLocalCardsOverlap: intersects(pot, localCards),
          seatCardsPanelOverlap: seatParts.some(
            ({ cards, panel }) =>
              cards && panel && intersects(rect(cards), rect(panel)),
          ),
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(geometry.table.width).toBeGreaterThanOrEqual(650);
      expect(geometry.table.width).toBeLessThanOrEqual(761);
      expect(geometry.stage.height).toBeGreaterThanOrEqual(569);
      expect(geometry.stage.height).toBeLessThanOrEqual(581);
      expect(geometry.table.left).toBeGreaterThanOrEqual(geometry.stage.left);
      expect(geometry.table.right).toBeLessThanOrEqual(geometry.stage.right);
      expect(geometry.table.top).toBeGreaterThanOrEqual(geometry.stage.top);
      expect(geometry.table.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
      expect(geometry.dock.top - geometry.heroSeat.bottom).toBeGreaterThanOrEqual(
        23,
      );
      expect(geometry.dock.top - geometry.heroSeat.bottom).toBeLessThanOrEqual(
        50,
      );
      expect(
        geometry.seats.every(
          (seat) =>
            seat.top >= geometry.stage.top - 1 &&
            seat.right <= geometry.stage.right + 1 &&
            seat.bottom <= geometry.stage.bottom + 1 &&
            seat.left >= geometry.stage.left - 1,
        ),
      ).toBe(true);
      expect(geometry.rail.top).toBeGreaterThanOrEqual(
        geometry.support.bottom + 10,
      );
      expect(
        Math.abs(geometry.rail.left - geometry.support.left),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.rail.right - geometry.support.right),
      ).toBeLessThanOrEqual(1);
      expect(geometry.rail.height).toBeGreaterThanOrEqual(259);
      expect(geometry.rail.height).toBeLessThanOrEqual(261);
      expect(
        Math.abs(geometry.viewportHeight - geometry.pageBottom),
      ).toBeLessThanOrEqual(48);
      expect(geometry.communityChipsOverlap).toBe(false);
      expect(geometry.potLocalCardsOverlap).toBe(false);
      expect(geometry.seatCardsPanelOverlap).toBe(false);
      expect(geometry.hasHorizontalOverflow).toBe(false);
    });
  }

  for (const viewport of [
    {
      label: "mobile upper edge short",
      width: 720,
      height: 844,
      aspectRatio: 1.4,
      requireSeparatedSeatCards: false,
    },
    {
      label: "intermediate lower edge short",
      width: 721,
      height: 844,
      aspectRatio: 1.75,
      requireSeparatedSeatCards: true,
    },
    {
      label: "intermediate upper edge short",
      width: 760,
      height: 844,
      aspectRatio: 1.75,
      requireSeparatedSeatCards: true,
    },
    {
      label: "compact lower edge short",
      width: 761,
      height: 844,
      aspectRatio: 1.85,
      requireSeparatedSeatCards: true,
    },
    {
      label: "mobile upper edge tall",
      width: 720,
      height: 1252,
      aspectRatio: 1.4,
      requireSeparatedSeatCards: false,
    },
    {
      label: "intermediate lower edge tall",
      width: 721,
      height: 1252,
      aspectRatio: 1.75,
      requireSeparatedSeatCards: true,
    },
    {
      label: "intermediate upper edge tall",
      width: 760,
      height: 1252,
      aspectRatio: 1.75,
      requireSeparatedSeatCards: true,
    },
    {
      label: "compact lower edge tall",
      width: 761,
      height: 1252,
      aspectRatio: 1.85,
      requireSeparatedSeatCards: true,
    },
    {
      label: "compact rail edge",
      width: 1100,
      height: 900,
      aspectRatio: 1.85,
      requireSeparatedSeatCards: true,
    },
    {
      label: "persistent rail edge",
      width: 1101,
      height: 900,
      aspectRatio: 1.8,
      requireSeparatedSeatCards: true,
    },
    {
      label: "intermediate desktop upper edge",
      width: 1350,
      height: 900,
      aspectRatio: 1.8,
      requireSeparatedSeatCards: true,
    },
    {
      label: "wide desktop lower edge",
      width: 1351,
      height: 900,
      aspectRatio: 2.2,
      requireSeparatedSeatCards: true,
    },
    {
      label: "former short-wide collision edge",
      width: 1395,
      height: 900,
      aspectRatio: 2.2,
      requireSeparatedSeatCards: true,
    },
    {
      label: "former short-wide clear edge",
      width: 1396,
      height: 900,
      aspectRatio: 2.2,
      requireSeparatedSeatCards: true,
    },
    {
      label: "wide desktop tall-rule lower height edge",
      width: 1351,
      height: 999,
      aspectRatio: 2.2,
      requireSeparatedSeatCards: true,
    },
    {
      label: "wide desktop tall-rule upper height edge",
      width: 1351,
      height: 1000,
      aspectRatio: 1.95,
      requireSeparatedSeatCards: true,
    },
    {
      label: "standard short desktop",
      width: 1440,
      height: 900,
      aspectRatio: 2.2,
      requireSeparatedSeatCards: true,
    },
    {
      label: "standard tall desktop",
      width: 1440,
      height: 1200,
      aspectRatio: 1.95,
      requireSeparatedSeatCards: true,
    },
  ]) {
    test(`${viewport.label} keeps postflop table geometry separated`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      await expect(
        page.locator('.poker-table[data-street="flop"]'),
      ).toBeVisible();
      await expect(
        page.locator(".community-cards .playing-card:not(.is-empty-slot)"),
      ).toHaveCount(3);

      const geometry = await page.evaluate(() => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            height: box.height,
          };
        };
        const required = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return element;
        };
        const intersects = (
          left: ReturnType<typeof rect>,
          right: ReturnType<typeof rect>,
        ) =>
          Math.max(left.left, right.left) <
            Math.min(left.right, right.right) - 1 &&
          Math.max(left.top, right.top) <
            Math.min(left.bottom, right.bottom) - 1;

        const stage = rect(required(".table-stage"));
        const table = rect(required(".poker-table"));
        const communityCards = rect(required(".community-cards"));
        const pot = rect(required(".pot-label"));
        const localCards = rect(
          required('.player-seat[data-local="true"] .seat-cards'),
        );
        const seats = Array.from(document.querySelectorAll(".player-seat")).map(
          (seat) => ({
            seat: rect(seat),
            cards: seat.querySelector(".seat-cards"),
            panel: seat.querySelector(".seat-panel"),
            chips: seat.querySelector(".committed-chips"),
          }),
        );

        return {
          stage,
          table,
          aspectRatio: table.width / table.height,
          communitySeatCardsOverlap: seats.some(
            ({ cards }) => cards && intersects(communityCards, rect(cards)),
          ),
          communitySeatPanelsOverlap: seats.some(
            ({ panel }) => panel && intersects(communityCards, rect(panel)),
          ),
          communityCommittedChipsOverlap: seats.some(
            ({ chips }) => chips && intersects(communityCards, rect(chips)),
          ),
          potLocalCardsOverlap: intersects(pot, localCards),
          seatCardsPanelOverlap: seats.some(
            ({ cards, panel }) =>
              cards && panel && intersects(rect(cards), rect(panel)),
          ),
          seatsInsideStage: seats.every(
            ({ seat }) =>
              seat.top >= stage.top - 1 &&
              seat.right <= stage.right + 1 &&
              seat.bottom <= stage.bottom + 1 &&
              seat.left >= stage.left - 1,
          ),
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(geometry.aspectRatio).toBeCloseTo(viewport.aspectRatio, 2);
      expect(geometry.communitySeatCardsOverlap).toBe(false);
      expect(geometry.communitySeatPanelsOverlap).toBe(false);
      expect(geometry.communityCommittedChipsOverlap).toBe(false);
      expect(geometry.potLocalCardsOverlap).toBe(false);
      if (viewport.requireSeparatedSeatCards) {
        expect(geometry.seatCardsPanelOverlap).toBe(false);
        expect(geometry.table.height).toBeGreaterThanOrEqual(320);
      }
      expect(geometry.seatsInsideStage).toBe(true);
      expect(geometry.table.left).toBeGreaterThanOrEqual(geometry.stage.left);
      expect(geometry.table.right).toBeLessThanOrEqual(geometry.stage.right);
      expect(geometry.table.top).toBeGreaterThanOrEqual(geometry.stage.top);
      expect(geometry.table.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
      expect(geometry.hasHorizontalOverflow).toBe(false);
    });
  }

  for (const viewport of [
    { label: "narrow judge short", width: 831, height: 900 },
    { label: "split screen short", width: 900, height: 900 },
    { label: "compact edge short", width: 1100, height: 900 },
  ]) {
    test(`${viewport.label} keeps history available through the dialog`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/play?mode=mock");

      const historyTrigger = page.getByRole("button", {
        name: "Open current hand history",
      });
      await expect(historyTrigger).toBeVisible();
      await expect(page.locator(".hand-feed-item.is-latest")).toBeHidden();

      await historyTrigger.click();
      const dialog = page.getByRole("dialog", { name: "Full hand history" });
      await expect(dialog).toBeVisible();
      await expect(historyTrigger).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("button", { name: "Close full hand history" }),
      ).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(historyTrigger).toBeFocused();

      await historyTrigger.click();
      await page.locator(".history-dialog-backdrop").click({
        position: { x: 5, y: 5 },
      });
      await expect(dialog).toHaveCount(0);
      await expect(historyTrigger).toBeFocused();
    });
  }
});
