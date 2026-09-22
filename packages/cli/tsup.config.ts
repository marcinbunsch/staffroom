import { defineConfig } from "tsup"

export default defineConfig({
  entry: { staffroom: "src/main.ts" },
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  target: "node26",
  clean: true,
  // Bundle the workspace packages and hono into the binary. They ship as
  // TypeScript source (no build step of their own), so left external Node would
  // try to import raw `.ts` and choke on syntax it does not strip.
  noExternal: [/^@staffroom\//, "hono"],
})
