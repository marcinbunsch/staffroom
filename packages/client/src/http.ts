/**
 * The shared HTTP plumbing every domain is built on. A domain module is a
 * factory `(ctx: DomainContext) => { …methods }`; `createClient` builds one
 * context and hands it to each. Every domain is on the typed `hc` client now,
 * so a domain builds `hc<XRoutes>(`${ctx.base}/api/...`, ctx.hcInit)` and shapes
 * failures with `apiError`; there is no bespoke fetch helper left.
 */
export interface ClientOptions {
  /** API origin. "" (the default) means same-origin — the browser case. */
  baseUrl?: string
  /** Extra headers on every request, e.g. a CLI's `authorization` bearer. */
  headers?: Record<string, string>
  /** Override fetch (tests, or a token-refreshing wrapper). */
  fetch?: typeof fetch
  /** The browser origin for OAuth redirects; defaults to `location.origin`. */
  origin?: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export interface DomainContext {
  /** API origin prefix ("" for same-origin). */
  base: string
  /** Browser origin for OAuth redirects. */
  origin: string
  /** Init to pass an `hc` client so it shares the client's auth and fetch. */
  hcInit: { headers?: Record<string, string>; fetch?: typeof fetch }
}

export function makeContext(options: ClientOptions): DomainContext {
  const base = options.baseUrl ?? ""
  const browserOrigin = (globalThis as { location?: { origin?: string } }).location?.origin
  const origin = options.origin ?? browserOrigin ?? base

  return {
    base,
    origin,
    hcInit: {
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  }
}

/** Turn a non-ok response (fetch or hc) into an ApiError, reading its `{ error }`. */
export async function apiError(response: {
  status: number
  statusText: string
  json(): Promise<unknown>
}): Promise<ApiError> {
  const body = await response.json().catch(() => ({}))
  return new ApiError(response.status, (body as { error?: string }).error ?? response.statusText)
}
