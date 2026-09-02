import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Specs that talk to Supabase read the same .env.local that Next loads.
loadEnvConfig(process.cwd());

const configuredPort = process.env.POCKET_E2E_PORT;
const port = configuredPort && /^\d+$/.test(configuredPort) ? configuredPort : "3000";
const baseURL = `http://localhost:${port}`;
const serverScript = process.env.POCKET_E2E_USE_BUILD === "1" ? "start" : "dev";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run ${serverScript} -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
