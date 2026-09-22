import { type Model, type Provider, createProvider } from "@earendil-works/pi-ai"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"

/**
 * LM Studio, and other keyless OpenAI-compatible local servers.
 *
 * LM Studio runs an OpenAI-compatible HTTP server on the operator's own machine
 * (by default `http://localhost:1234/v1`). It is not one of pi-ai's built-in
 * providers, so we construct one here — same `openai-completions` dialect as
 * OpenAI's classic Chat Completions API, pointed at the operator's endpoint.
 *
 * Two things make it unlike the cloud providers:
 *
 *  - **The catalog is whatever the operator has loaded.** We ask LM Studio for
 *    its native model catalog and register concrete models from that response.
 *    Concrete metadata is important: Flue's dynamic-model fallback has a zero
 *    token context window, which makes pi-ai clamp every completion to one
 *    token. The catalog carries the live context window instead.
 *
 *  - **There is no key.** The server accepts any bearer token, so auth is
 *    supplied by the caller ({@link registry}) rather than resolved here.
 */

const FALLBACK_CONTEXT_WINDOW = 32_768
const MAX_OUTPUT_TOKENS = 8_192

/** Build a per-credential LM Studio provider pointed at one endpoint. */
export function lmStudioProvider(options: {
  id: string
  name: string
  baseUrl: string
  auth: Provider["auth"]
  models?: Model<"openai-completions">[]
}): Provider {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  return createProvider({
    id: options.id,
    name: options.name,
    baseUrl,
    auth: options.auth,
    models: (options.models ?? []).map((model) => ({
      ...model,
      provider: options.id,
      baseUrl,
    })),
    api: { "openai-completions": openAICompletionsApi() },
  })
}

/**
 * Read concrete models and their context windows from LM Studio. Its native
 * endpoint provides this metadata; the OpenAI-compatible `/models` endpoint
 * only lists ids. Fall back to a conservative context window for another
 * OpenAI-compatible server that does not implement LM Studio's native API.
 */
export async function fetchLmStudioModelCatalog(
  baseUrl: string,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<Model<"openai-completions">[]> {
  const modelsUrl = `${nativeBaseUrl(baseUrl)}/api/v0/models`
  try {
    const response = await fetch(modelsUrl, {
      signal: options.signal,
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
    })
    if (!response.ok) throw new LmStudioUnreachable(`the server answered ${response.status}`)
    const body = (await response.json()) as { data?: LmStudioModel[] } | LmStudioModel[]
    const entries = Array.isArray(body) ? body : (body.data ?? [])
    const models = entries
      .filter((entry): entry is LmStudioModel & { id: string } => typeof entry.id === "string")
      .map((entry) => modelFrom(entry.id, entry.loaded_context_length ?? entry.max_context_length))
    if (models.length > 0) return withBareAliases(models)
  } catch (error) {
    if (!(error instanceof LmStudioUnreachable || error instanceof TypeError)) throw error
  }

  const ids = await fetchLmStudioModels(baseUrl, options)
  return withBareAliases(ids.map((id) => modelFrom(id, FALLBACK_CONTEXT_WINDOW)))
}

/**
 * The models a running LM Studio server currently has loaded, best-effort.
 *
 * Used to *show* an operator what they can point a staff row at; it is not on
 * the path of a turn, so a server that is down returns an empty list rather
 * than an error the operator has to reason about.
 */
export async function fetchLmStudioModels(
  baseUrl: string,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    signal: options.signal,
    headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
  })
  if (!response.ok) throw new LmStudioUnreachable(`the server answered ${response.status}`)
  const body = (await response.json()) as { data?: { id?: unknown }[] }
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

export class LmStudioUnreachable extends Error {
  constructor(detail: string) {
    super(`could not reach the LM Studio server: ${detail}`)
    this.name = "LmStudioUnreachable"
  }
}

interface LmStudioModel {
  id?: unknown
  loaded_context_length?: unknown
  max_context_length?: unknown
}

function modelFrom(id: string, context: unknown): Model<"openai-completions"> {
  const contextWindow =
    typeof context === "number" && Number.isFinite(context) && context > 0
      ? context
      : FALLBACK_CONTEXT_WINDOW
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(MAX_OUTPUT_TOKENS, contextWindow),
  }
}

/**
 * LM Studio commonly prefixes its catalog ids with a publisher (`qwen/foo`),
 * while agent rows have historically accepted the final segment (`foo`). Keep
 * that shorthand working when it points to exactly one catalog model.
 */
function withBareAliases(models: Model<"openai-completions">[]): Model<"openai-completions">[] {
  const byBareId = new Map<string, Model<"openai-completions">[]>()
  for (const model of models) {
    const bareId = model.id.slice(model.id.lastIndexOf("/") + 1)
    const matches = byBareId.get(bareId) ?? []
    matches.push(model)
    byBareId.set(bareId, matches)
  }

  const aliases = [...byBareId.entries()].flatMap(([bareId, matches]) => {
    const [model] = matches
    if (matches.length !== 1 || !model || bareId === model.id) return []
    return [{ ...model, id: bareId, name: bareId }]
  })
  return [...models, ...aliases]
}

/** Trim a trailing slash so `${baseUrl}/models` never doubles up. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

/** The native LM Studio API is rooted at the server origin, not `/v1`. */
function nativeBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).origin
}
