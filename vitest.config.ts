import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportOnFailure: true,
      // Reporting only: no minimum coverage thresholds yet.
    },
  },
});
