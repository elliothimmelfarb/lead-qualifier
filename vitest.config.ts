import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests (test/) and the persona simulation harness (sim/) both run
    // under `npm test`. The sim suite is an integration test: it plays whole
    // conversations end to end against the mock model.
    include: ["test/**/*.test.ts", "sim/**/*.test.ts"],
  },
});
