import { z } from "zod"
import { TenantId } from "./identity.ts"

/**
 * How a model turn gets paid for.
 *
 * Two scopes, mirroring the rule the plan already sets for tool credentials:
 * an **org** credential is an admin's shared API key, and a **user**
 * credential belongs to one person. Every registered credential becomes one
 * Flue provider, so choosing a credential and choosing a provider are the same
 * act — which is what keeps a per-tenant key working inside a single
 * process-global runtime.
 */
export const CredentialScope = z.enum(["org", "user"])

/**
 * How the credential authenticates.
 *
 * `api_key` is a key the operator pastes. `codex_oauth` is an imported
 * ChatGPT/Codex login — the `auth.json` a `codex login` leaves behind, which
 * the server then refreshes on its own. The import exists because it is the
 * one credential a person already has and cannot copy out as a string.
 * `local` is a keyless local server (LM Studio, and the like): it carries no
 * secret, just the endpoint it runs on.
 */
export const CredentialKind = z.enum(["api_key", "codex_oauth", "local"])

/** The pi-ai provider this credential authenticates against. */
export const UpstreamProvider = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an upstream provider id is lowercase, digits and hyphens")

/** The upstream a local LM Studio server registers as. */
export const LM_STUDIO_UPSTREAM = "lm-studio"

/** LM Studio's default OpenAI-compatible endpoint. */
export const LM_STUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1"

/** What a credential looks like to a client. The secret itself never appears. */
export const ModelCredential = z.object({
  id: z.string(),
  scope: CredentialScope,
  /** Null for an org credential — it belongs to the organization, not a person. */
  tenantId: TenantId.nullable(),
  kind: CredentialKind,
  upstream: UpstreamProvider,
  label: z.string().min(1).max(120),
  /**
   * The credential staff rows that name none fall back to. Exactly one
   * credential (of any scope) may hold this.
   */
  isDefault: z.boolean(),
  /**
   * The model an agent gets when it names none — set only on the default
   * credential, and picked from that credential's available models.
   */
  defaultModel: z.string().nullable(),
  /** A hint like `sk-ant-…9f2c`, so an operator can tell two keys apart. */
  hint: z.string(),
  /**
   * The endpoint a `local` credential points at, e.g.
   * `http://localhost:1234/v1`. Empty for cloud credentials, which carry their
   * base URL in the upstream itself.
   */
  baseUrl: z.string().default(""),
  /** The Flue provider id this credential registers as. Derived, never stored. */
  providerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ApiKeyCredentialInput = z.object({
  scope: CredentialScope,
  kind: z.literal("api_key").default("api_key"),
  upstream: UpstreamProvider,
  label: z.string().min(1).max(120),
  apiKey: z.string().min(1),
  isDefault: z.boolean().default(false),
})

/**
 * An imported Codex login: the contents of `~/.codex/auth.json`.
 *
 * The desktop app reads that file itself; the browser asks for it as an
 * upload. Either way the server is what stores and refreshes it, so an agent
 * running unattended at 3am is not depending on a file in some laptop's home
 * directory.
 */
export const CodexCredentialInput = z.object({
  scope: CredentialScope,
  kind: z.literal("codex_oauth").default("codex_oauth"),
  label: z.string().min(1).max(120),
  /** The parsed `auth.json`, verbatim. */
  authJson: z.object({
    tokens: z.object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1),
      account_id: z.string().optional(),
    }),
  }),
  isDefault: z.boolean().default(false),
})

/**
 * A keyless local model server, such as LM Studio.
 *
 * There is no secret to store — the server runs on the operator's own machine
 * (or LAN) and accepts any bearer token. What it needs instead is *where* it
 * runs, so the base URL is the credential. It is per-credential rather than a
 * single global setting because two people may each run their own LM Studio,
 * and an org may point at a shared box on a different host or port.
 */
export const LocalCredentialInput = z.object({
  scope: CredentialScope,
  kind: z.literal("local").default("local"),
  upstream: UpstreamProvider,
  label: z.string().min(1).max(120),
  /** e.g. `http://localhost:1234/v1`. */
  baseUrl: z.string().url().default(LM_STUDIO_DEFAULT_BASE_URL),
  /**
   * Optional bearer token. A bare LM Studio server accepts any token, but one
   * put behind its API-key setting (or a reverse proxy) needs a real one.
   */
  apiKey: z.string().optional(),
  isDefault: z.boolean().default(false),
})

export const CredentialInput = z.union([
  ApiKeyCredentialInput,
  CodexCredentialInput,
  LocalCredentialInput,
])

export type CredentialScope = z.infer<typeof CredentialScope>
export type CredentialKind = z.infer<typeof CredentialKind>
export type ModelCredential = z.infer<typeof ModelCredential>
export type ApiKeyCredentialInput = z.infer<typeof ApiKeyCredentialInput>
export type CodexCredentialInput = z.infer<typeof CodexCredentialInput>
export type LocalCredentialInput = z.infer<typeof LocalCredentialInput>
export type CredentialInput = z.infer<typeof CredentialInput>

/** The upstream a Codex import always authenticates against. */
export const CODEX_UPSTREAM = "openai-codex"

/**
 * A ChatGPT/Codex rate-limit window — how much of one limit has been spent and
 * when it resets. The plan has two: a short rolling window (the "5h" primary)
 * and a long one (the weekly secondary). Read from ChatGPT's own usage endpoint
 * the Codex client uses; the shape is undocumented, so every field is defensive.
 */
export const CodexUsageWindow = z.object({
  /** 0–100. */
  usedPercent: z.number(),
  /** The window's length in minutes, when the endpoint reports it. */
  windowMinutes: z.number().nullable(),
  /** When the window rolls over, epoch seconds. */
  resetsAt: z.number().nullable(),
})

/** A snapshot of a Codex login's usage against its plan limits. */
export const CodexUsage = z.object({
  planType: z.string().nullable(),
  primary: CodexUsageWindow.nullable(),
  secondary: CodexUsageWindow.nullable(),
  /** When this snapshot was taken, epoch milliseconds. */
  capturedAt: z.number(),
})

export type CodexUsageWindow = z.infer<typeof CodexUsageWindow>
export type CodexUsage = z.infer<typeof CodexUsage>
