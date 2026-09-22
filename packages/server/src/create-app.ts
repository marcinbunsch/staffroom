import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import type { Hono as HonoApp, MiddlewareHandler } from "hono"
import { apiRoutes } from "./routes/api-routes.ts"
import { keysRoutes } from "./routes/keys-routes.ts"
import { staffRoutes } from "./routes/staff-routes.ts"
import { credentialRoutes } from "./routes/credential-routes.ts"
import { jobRoutes } from "./routes/job-routes.ts"
import { fileRoutes } from "./routes/file-routes.ts"
import { attentionRoutes } from "./routes/attention-routes.ts"
import { memoryRoutes } from "./routes/memory-routes.ts"
import { skillRoutes } from "./routes/skill-routes.ts"
import { searchRoutes } from "./routes/search-routes.ts"
import { spendRoutes } from "./routes/spend-routes.ts"
import { toolRoutes } from "./routes/tool-routes.ts"
import { chatRoutes } from "./routes/chat-routes.ts"
import { integrationRoutes } from "./routes/integration-routes.ts"
import { teamRoutes } from "./routes/team-routes.ts"
import { toolsetRoutes } from "./routes/toolset-routes.ts"
import { oauthRoutes } from "./routes/oauth-routes.ts"
import { scheduleRoutes } from "./routes/schedule-routes.ts"
import { widgetRoutes } from "./routes/widget-routes.ts"
import { dashboardRoutes } from "./routes/dashboard-routes.ts"
import { operatorRoutes } from "./routes/operator-routes.ts"
import { operatorProfileRoutes } from "./routes/operator-profile-routes.ts"
import { pushRoutes } from "./routes/push-routes.ts"
import type { Auth } from "./core/auth.ts"
import { anyAccountExists } from "./core/accounts.ts"
import { serverBaseUrl, singleUserMode } from "./core/config.ts"
import { getRosterStore } from "./coordinator/roster.ts"
import {
  type SessionEnv,
  rejectForeignSession,
  rejectUnknownAgent,
  requireSession,
} from "./middleware/session.ts"

/**
 * The whole request pipeline, in the order it runs.
 *
 * The agent router is a parameter rather than an import for two reasons. It is
 * the same "inject, don't import" seam the coordinator uses for dispatch — and
 * it is what makes the pipeline testable, since a `"use agent"` module only
 * compiles through Flue's vite plugin and the tests deliberately run without
 * it. `app.ts` supplies the real one.
 */
export interface AppOptions {
  auth: Auth
  /** Mounted under `/agents`. The real one is `createAgentRouter(StaffAgent)`. */
  agentRouter: HonoApp
  /** Where the built SPA lives. Defaults to the sibling `ui/dist`. */
  uiDir?: string
}

export function createApp(options: AppOptions) {
  const { auth } = options
  const app = new Hono<SessionEnv>()

  // A single-user server listens on loopback only, but a web page can still
  // reach loopback by DNS rebinding — a hostname of its own that resolves to
  // 127.0.0.1. Such a request names that hostname rather than ours, so it is
  // refused before anything else runs.
  if (singleUserMode()) app.use("*", loopbackHostOnly(serverBaseUrl()))

  // Sign-up is open only for first-run setup: once any account exists it is
  // closed, and an admin adds people. Registered before the auth catch-all so it
  // gates the email sign-up endpoints; sign-in/out and OAuth fall through. Set
  // STAFFROOM_OPEN_SIGNUP to re-open it (e.g. to add another account). A
  // single-user server never opens it: its one account is made by local sign-in.
  app.on("POST", "/api/auth/sign-up/*", async (context, next) => {
    if (singleUserMode()) {
      return context.json({ error: "Sign-up is closed on a single-user server." }, 403)
    }
    if (!process.env.STAFFROOM_OPEN_SIGNUP && anyAccountExists()) {
      return context.json({ error: "Sign-up is closed. Ask an admin to add your account." }, 403)
    }
    await next()
  })
  // Nor can an admin add accounts to a single-user server.
  app.on("POST", "/api/auth/admin/create-user", async (context, next) => {
    if (singleUserMode()) {
      return context.json({ error: "A single-user server has only one account." }, 403)
    }
    await next()
  })

  /** better-auth owns sign-up, sign-in and sign-out. Ungated, necessarily. */
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw))

  // OAuth callbacks are public: Google's redirect is a top-level navigation that
  // cannot carry our session cookie, so identity comes from the one-shot state.
  // Mounted before the session gate for that reason.
  app.route("/", oauthRoutes)

  // Resolve the caller once, for everything that is not the auth routes. This
  // sits at the root so it runs before Flue admits any conversation — Flue
  // discards caller headers after admission, so there is no later place it
  // could run.
  const resolveCaller = async (headers: Headers) => {
    // A malformed or unknown `x-api-key` makes the apiKey plugin *throw* rather
    // than return no session; treat that as "no caller" (a clean 401) instead of
    // letting it bubble to a 500. A bad key is an auth failure, not a server one.
    const session = await auth.api.getSession({ headers }).catch(() => null)
    if (!session) return undefined
    return { tenantId: session.user.id, role: session.user.role ?? "user" }
  }

  app.use("/api/*", requireSession(resolveCaller))
  app.use("/agents/*", requireSession(resolveCaller))
  // Every domain router is relative-pathed and mounted at its /api/<x> prefix,
  // so each router's type stays clean for the hc client. apiRoutes holds only
  // /api/me; oauth + operator carry their own full paths and mount at root.
  app.route("/api/me", apiRoutes)
  app.route("/api/keys", keysRoutes)
  app.route("/api/staff", staffRoutes)
  app.route("/api/files", fileRoutes)
  app.route("/api/jobs", jobRoutes)
  app.route("/api/schedules", scheduleRoutes)
  app.route("/api/widgets", widgetRoutes)
  app.route("/api/dashboards", dashboardRoutes)
  app.route("/api/attention", attentionRoutes)
  app.route("/api/search", searchRoutes)
  app.route("/api/integrations", integrationRoutes)
  app.route("/api/model-credentials", credentialRoutes)
  app.route("/api/teams", teamRoutes)
  app.route("/api/tools", toolRoutes)
  app.route("/api/spend", spendRoutes)
  app.route("/api/toolsets", toolsetRoutes)
  app.route("/api/chats", chatRoutes)
  app.route("/api/skills", skillRoutes)
  app.route("/api/memory", memoryRoutes)
  app.route("/api/operator/profile", operatorProfileRoutes)
  app.route("/api/push", pushRoutes)
  app.route("/", operatorRoutes)

  // The two guards, in this order. Ownership first: a foreign session key is
  // refused before the roster is consulted, so a 404 cannot leak whether
  // another tenant has a given agent.
  const hasAgent = (tenantId: string, agentId: string) =>
    getRosterStore().get(tenantId, agentId) !== undefined

  for (const path of ["/agents/:id", "/agents/:id/*"]) {
    app.use(path, rejectForeignSession())
    app.use(path, rejectUnknownAgent(hasAgent))
  }
  app.route("/agents", options.agentRouter)

  mountUi(app, options.uiDir ?? fileURLToPath(new URL("../../ui/dist", import.meta.url)))
  return app
}

/**
 * 403 unless the request names this server's own loopback address (the Host a
 * browser sends is the name it resolved, so a rebound hostname shows up here).
 */
function loopbackHostOnly(baseUrl: string): MiddlewareHandler {
  const { port } = new URL(baseUrl)
  const suffix = port ? `:${port}` : ""
  const allowed = new Set([`127.0.0.1${suffix}`, `localhost${suffix}`])
  return async (context, next) => {
    if (!allowed.has(new URL(context.req.url).host)) {
      return context.json({ error: "forbidden_host" }, 403)
    }
    await next()
  }
}

/**
 * The SPA. Its static assets are deliberately not gated: the browser has to
 * load the app before anyone can sign in. The session gates the data, not the
 * shell.
 */
function mountUi(app: Hono<SessionEnv>, uiDir: string): void {
  app.get("*", async (context) => {
    const requested = context.req.path === "/" ? "/index.html" : context.req.path
    const filePath = join(uiDir, normalize(requested))
    if (filePath.startsWith(uiDir) && existsSync(filePath)) {
      return context.body(await readFile(filePath), 200, {
        "content-type": contentTypeOf(filePath),
      })
    }
    const index = join(uiDir, "index.html")
    if (!existsSync(index)) return context.text("UI not built. Run `pnpm build`.", 404)
    return context.html(await readFile(index, "utf8"))
  })
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream"
}
