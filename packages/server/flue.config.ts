import { defineConfig } from "@flue/runtime/config"

// Host-independent project config, read by the @flue/vite plugin. Node target:
// `vite build` produces dist/server.mjs.
export default defineConfig({
  target: "node",
})
