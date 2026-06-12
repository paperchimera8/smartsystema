import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const windowsPreviewApiBaseUrl =
  process.env.VITE_API_BASE_URL?.trim() || "";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define:
    mode === "production"
      ? {
          "import.meta.env.VITE_API_BASE_URL": JSON.stringify(windowsPreviewApiBaseUrl)
        }
      : {},
  clearScreen: false,
  resolve: {
    alias: {
      "@automator/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url)
      )
    }
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 1420
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/App.tsx", "src/module-workflow.ts"]
    }
  }
}));
