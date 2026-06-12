import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const apiRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@automator/contracts": resolve(apiRoot, "../../packages/contracts/src/index.ts")
    }
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/modules/drafts/drafts.controller.ts",
        "src/modules/drafts/drafts.service.ts",
        "src/modules/drafts/drafts.repository.ts",
        "src/modules/drafts/drafts.errors.ts",
        "src/modules/document-exceptions/document-exceptions.controller.ts",
        "src/modules/document-exceptions/document-exceptions.service.ts",
        "src/modules/document-exceptions/document-exceptions.repository.ts",
        "src/modules/document-exceptions/document-exceptions.errors.ts"
      ]
    }
  }
});
