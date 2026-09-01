import { expect, test } from "@playwright/test";

test.describe("in-game activity clarity", () => {
  test("keeps the latest actions and legal mechanics beside the controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play?mode=mock");

    const trail = page.locator(".decision-activity-list li");
    await expect(trail).toHaveCount(3);
    await expect(trail.nth(0)).toContainText("You called 6");
    await expect(trail.nth(1)).toContainText("You bet 12");
    await expect(trail.nth(2)).toContainText("Alex raised to 44");
    await expect(trail.nth(2)).toContainText("Latest");
    await expect(trail.nth(2)).toHaveAttribute("aria-current", "true");

    await expect(page.locator(".decision-guidance")).toHaveText(
      "It costs 32 chips to continue. Fold, Call 32, or Raise 64–184.",
    );
    await expect(
      page.locator('.seat-1 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText(
      "Raised to 44",
    );
    await expect(
      page.locator('.seat-0 .seat-action-cue > [aria-hidden="true"]'),
    ).toHaveText("In 12");

    const latestHistory = page.locator(".history-item.is-latest");
    await expect(latestHistory).toContainText("Latest");
    await expect(latestHistory).toContainText("Alex");
    await expect(latestHistory).toContainText("raise to 44");
    await expect(page.getByText("The table is live.")).toHaveCount(0);

    await page.getByRole("button", { name: "Call 32" }).click();
    await expect(page.locator(".decision-notice")).toContainText(
      "You chose call 32",
    );
    await expect(page.locator(".decision-activity-list li.is-latest")).toContainText(
      "You called 32",
    );
    await expect(page.locator(".decision-activity-list li.is-latest")).toContainText(
      "Alex called 32",
      { timeout: 3_000 },
    );
    await expect(page.locator(".decision-guidance")).toHaveText(
      "No bet to match. Check for free or Bet 8–148.",
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

      await expect(page.locator(".decision-activity-list li.is-latest")).toContainText(
        "Alex raised to 44",
      );
      await expect(page.locator(".decision-guidance")).toBeVisible();
      await expect(page.getByRole("button", { name: "Call 32" })).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
