import { defineConfig } from "vitest/config"

// Deliberately does not load vite.config.ts: the flue() plugin compiles
// "use agent" modules for the server bundle, and the tests exercise plain
// modules (stores, guards, tool helpers) that do not need it.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
