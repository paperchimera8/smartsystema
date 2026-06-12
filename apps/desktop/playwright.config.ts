import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command:
      "VITE_API_BASE_URL=http://127.0.0.1:43170 pnpm --filter @automator/desktop exec vite --host 127.0.0.1 --port 1421",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
