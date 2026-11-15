import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
