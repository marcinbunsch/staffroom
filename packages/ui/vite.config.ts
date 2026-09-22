import type { IncomingMessage } from "node:http"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import httpProxy from "http-proxy"
import { defineConfig, type Plugin } from "vite"

// Built to dist/ and served by the server's app.ts, so the UI is same-origin
// with the API: the better-auth session cookie needs no cross-origin handling,
// and there is one port to expose. In dev, the API is proxied to a server.
const API_PREFIXES = ["/api", "/agents", "/oauth"]
const DEFAULT_TARGET = process.env.STAFFROOM_SERVER_URL ?? "http://127.0.0.1:5317"

/**
 * Dev-only API proxy with a *dynamic* target. The target is chosen per request:
 * an `x-staffroom-target` header wins, else `STAFFROOM_SERVER_URL`, else the
 * local dev server. The desktop shell sets that header per account window, so a
 * single Vite dev server can drive the hot-reloading UI against whichever server
 * the account switcher picks — one server per window, without cross-origin auth
 * (the browser only ever sees this Vite origin; cookies are rewritten to it).
 */
function dynamicApiProxy(): Plugin {
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, cookieDomainRewrite: "" })
  proxy.on("error", (error, _request, response) => {
    if (response && "writeHead" in response && !response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain" })
      response.end(`proxy error: ${error.message}`)
    }
  })
  const target = (request: IncomingMessage) =>
    String(request.headers["x-staffroom-target"] ?? DEFAULT_TARGET)
  const matches = (url: string | undefined) =>
    !!url && API_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))

  return {
    name: "staffroom-dev-api-proxy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!matches(request.url)) return next()
        proxy.web(request, response, { target: target(request) })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dynamicApiProxy()],
  server: {
    host: "127.0.0.1",
    // Configurable so `dev` and `dev:desktop` can run side by side on distinct
    // ports, both kept off the built app's 4317/4318 so a local production build
    // stays free. Defaults to 5318.
    port: Number(process.env.STAFFROOM_UI_PORT ?? 5318),
    strictPort: true,
  },
  build: {
    // The only chunks over the default 500 kB are the lazy vega chart engine
    // (vega-embed + vega core), loaded on demand when a chart renders and not
    // meaningfully splittable. Raise the warning to 1 MB so it stops flagging
    // those, while still catching a genuine eager-bundle regression.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        // Split stable third-party code out of the app entry chunk. Without this
        // everything (React, router, mobx, markdown, auth) plus every route lands
        // in one ~930 kB `index` chunk that must download before anything renders
        // and re-downloads whenever any app code changes. Grouping vendors keeps
        // the entry small and lets browsers cache these across deploys. Charting
        // libs (mermaid/vega/katex/cytoscape) are already dynamically imported, so
        // they stay in their own lazy chunks and are intentionally left alone — we
        // only name the vendors that are already part of the eager entry, and avoid
        // a catch-all node_modules group (it would drag the lazy chart libs back
        // into an eager chunk).
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: "router", test: /node_modules\/react-router\// },
            { name: "mobx", test: /node_modules\/(mobx|mobx-react-lite)\// },
            {
              name: "markdown",
              test: /node_modules\/(react-markdown|remark-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated-tokens|comma-separated-tokens|hastscript|estree-)/,
            },
          ],
        },
      },
    },
  },
})
