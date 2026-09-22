import { zValidator } from "@hono/zod-validator"
import {
  ApiKeyCredentialInput,
  CodexCredentialInput,
  CredentialScope,
  LocalCredentialInput,
} from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { CredentialInUseError, getModelCredentialStore } from "../coordinator/model-credentials.ts"
import type { SessionEnv } from "../middleware/session.ts"
import { fetchCodexUsage } from "../providers/codex-usage.ts"
import { LmStudioUnreachable, fetchLmStudioModels } from "../providers/lm-studio.ts"
import {
  CodexImportError,
  codexAccountId,
  parseCodexAuthFile,
  resolveCodexAccessToken,
} from "../providers/openai-codex.ts"
import {
  builtinModelIds,
  listUpstreams,
  registerCredentialProvider,
  unregisterCredentialProvider,
} from "../providers/registry.ts"

/** A credential the operator supplies directly: a pasted key, or a local server. */
const DirectCredentialInput = ApiKeyCredentialInput.or(LocalCredentialInput)

/** The `:id` path param shared by the per-credential routes. */
const idParam = z.object({ id: z.string() })

/**
 * A Codex import posted as JSON: the operator's machine reads
 * `~/.codex/auth.json` and posts its text here. The optional fields fall back
 * to the same defaults the handler used before, so a bare `{ contents }` still
 * imports a personal login labelled "ChatGPT login".
 */
const CodexImportInput = z.object({
  contents: z.string(),
  scope: CredentialScope.default("user").catch("user"),
  label: z.string().default("ChatGPT login").catch("ChatGPT login"),
  isDefault: z.boolean().default(false).catch(false),
})

/**
 * Model credentials: an organization's shared keys, and each person's own.
 *
 * Two rules run through every handler here. An **org** credential is
 * admin-only, because it spends the organization's money and is offered to
 * everybody. And a stored secret is write-only over the API — it goes in, it is
 * never read back, and what comes out is a label and a hint.
 *
 * Mounted at `/api/model-credentials`, so the paths here are relative — that
 * keeps the type (`ModelCredentialRoutes`) clean for the Hono RPC client. The
 * fixed routes (`/upstreams`, `/codex`) are chained before the `/:id` routes so
 * the param cannot capture them.
 */
export const credentialRoutes = new Hono<SessionEnv>()
  /** The upstreams a credential may name, for the settings picker. */
  .get("/upstreams", (context) => context.json({ upstreams: listUpstreams() }))
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ credentials: getModelCredentialStore().list(tenantId) })
  })
  .post(
    "/",
    zValidator("json", DirectCredentialInput, (result, context) => {
      if (!result.success) {
        return context.json({ error: "invalid_credential", issues: result.error.issues }, 400)
      }
    }),
    async (context) => {
      const caller = context.get("caller")
      const data = context.req.valid("json")
      if (data.scope === "org" && caller.role !== "admin") {
        return context.json({ error: "admin_required" }, 403)
      }

      const credential = getModelCredentialStore().create(caller.tenantId, data)
      await registerCredentialProvider(credential)
      return context.json({ credential }, 201)
    },
  )
  /**
   * The models a credential can run, for the agent model picker: a Codex login's
   * available slugs, a local server's loaded models, else empty (the picker then
   * offers a free-text field). Best-effort — a Codex endpoint hiccup or a local
   * server that is down is an empty list, not an error the caller must handle,
   * except a local server that is explicitly unreachable, which is a 502 so the
   * operator knows to start it.
   */
  .get("/:id/models", zValidator("param", idParam), async (context) => {
    const { tenantId } = context.get("caller")
    const store = getModelCredentialStore()
    const credential = store.get(tenantId, context.req.valid("param").id)
    if (!credential) return context.json({ error: "unknown_credential" }, 404)

    // A local server's catalog is whatever it currently has loaded, fetched from
    // the endpoint; a 502 tells the operator to start it.
    if (credential.kind === "local" && credential.baseUrl) {
      try {
        const apiKey = store.secretOf(credential.id)?.secret || undefined
        const models = await fetchLmStudioModels(credential.baseUrl, { apiKey })
        await registerCredentialProvider(credential, store)
        return context.json({ models })
      } catch (error) {
        if (error instanceof LmStudioUnreachable || error instanceof TypeError) {
          return context.json({ error: "server_unreachable" }, 502)
        }
        throw error
      }
    }

    // Every other upstream (Codex, OpenAI, Anthropic, …) is a pi-ai built-in;
    // its catalog is the runtime's own, so a picked model is one Flue can run.
    return context.json({ models: builtinModelIds(credential.upstream) })
  })
  /**
   * Make this credential the one agents fall back to, and record the model they
   * fall back to with it. Admin-only: the default spends on behalf of everyone
   * whose agents name no credential of their own.
   */
  .post(
    "/:id/default",
    zValidator("param", idParam),
    zValidator("json", z.object({ model: z.string().min(1) }), (result, context) => {
      if (!result.success) return context.json({ error: "model_required" }, 400)
    }),
    (context) => {
      const caller = context.get("caller")
      if (caller.role !== "admin") return context.json({ error: "admin_required" }, 403)
      const store = getModelCredentialStore()
      const credential = store.setDefault(
        caller.tenantId,
        context.req.valid("param").id,
        context.req.valid("json").model,
      )
      if (!credential) return context.json({ error: "unknown_credential" }, 404)
      return context.json({ credential })
    },
  )
  /**
   * Import a `codex login`.
   *
   * The operator's machine reads `~/.codex/auth.json` and posts its text here;
   * the server ends up owning the login, which is the entire point — an agent
   * running unattended overnight cannot depend on a file in somebody's laptop.
   */
  .post(
    "/codex",
    zValidator("json", CodexImportInput, (result, context) => {
      if (!result.success) return context.json({ error: "invalid_import" }, 400)
    }),
    async (context) => {
      const caller = context.get("caller")
      const body = context.req.valid("json")

      let authJson
      try {
        authJson = parseCodexAuthFile(body.contents)
      } catch (error) {
        if (error instanceof CodexImportError) {
          return context.json({ error: "invalid_codex_auth", message: error.message }, 400)
        }
        throw error
      }

      const parsed = CodexCredentialInput.safeParse({
        scope: body.scope,
        label: body.label,
        authJson,
        isDefault: body.isDefault,
      })
      if (!parsed.success) {
        return context.json({ error: "invalid_credential", issues: parsed.error.issues }, 400)
      }
      if (parsed.data.scope === "org" && caller.role !== "admin") {
        return context.json({ error: "admin_required" }, 403)
      }

      const credential = getModelCredentialStore().create(caller.tenantId, parsed.data)
      await registerCredentialProvider(credential)
      return context.json({ credential }, 201)
    },
  )
  /**
   * The caller's live Codex usage against their plan limits, for the composer
   * gauge. Reads the first Codex login the caller may use (their own, else the
   * org's) and asks ChatGPT's usage endpoint. Every failure — no login, a
   * refused token, an unreachable endpoint — is a plain `{ usage: null }`, since
   * a background poll must never turn into an error the operator has to dismiss.
   */
  .get("/codex/usage", async (context) => {
    const { tenantId } = context.get("caller")
    const store = getModelCredentialStore()
    const credential = store.list(tenantId).find((row) => row.kind === "codex_oauth")
    if (!credential) return context.json({ usage: null })
    const secret = store.secretOf(credential.id)
    if (!secret) return context.json({ usage: null })
    const accessToken = await resolveCodexAccessToken(credential.id, secret.secret, store).catch(
      () => undefined,
    )
    if (!accessToken) return context.json({ usage: null })
    const usage = await fetchCodexUsage(accessToken, codexAccountId(secret.secret))
    return context.json({ usage: usage ?? null })
  })
  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator("json", z.object({ label: z.string() }), (result, context) => {
      if (!result.success) return context.json({ error: "label_required" }, 400)
    }),
    async (context) => {
      const caller = context.get("caller")
      const store = getModelCredentialStore()
      const existing = store.get(caller.tenantId, context.req.valid("param").id)
      if (!existing) return context.json({ error: "unknown_credential" }, 404)
      if (existing.scope === "org" && caller.role !== "admin") {
        return context.json({ error: "admin_required" }, 403)
      }
      const label = context.req.valid("json").label.trim()
      if (!label) return context.json({ error: "label_required" }, 400)
      const credential = store.rename(caller.tenantId, existing.id, label)
      return context.json({ credential })
    },
  )
  .delete("/:id", zValidator("param", idParam), (context) => {
    const caller = context.get("caller")
    const store = getModelCredentialStore()
    const credential = store.get(caller.tenantId, context.req.valid("param").id)
    if (!credential) return context.json({ error: "unknown_credential" }, 404)
    if (credential.scope === "org" && caller.role !== "admin") {
      return context.json({ error: "admin_required" }, 403)
    }

    try {
      store.remove(caller.tenantId, credential.id)
    } catch (error) {
      // Refused rather than cascaded: nulling the column instead would silently
      // repoint those agents at the org credential, which is a different bill.
      if (error instanceof CredentialInUseError) {
        return context.json({ error: "credential_in_use", agents: error.agents }, 409)
      }
      throw error
    }
    unregisterCredentialProvider(credential)
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<ModelCredentialRoutes>`). */
export type ModelCredentialRoutes = typeof credentialRoutes
