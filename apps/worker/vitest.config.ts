import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/entity-resolution/counterparty-fuzzy.ts",
        "src/entity-resolution/nomenclature-fuzzy.ts"
      ]
    }
  }
});
