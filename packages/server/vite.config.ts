import { flue } from "@flue/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [flue()],
  server: {
    host: "127.0.0.1",
    // Dev server port. Kept off the built server's 4317 so a local production
    // build stays free; overridable via env. Defaults to 5317.
    port: Number(process.env.STAFFROOM_SERVER_PORT ?? 5317),
    strictPort: true,
  },
})
