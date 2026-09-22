import type { Provider } from "@earendil-works/pi-ai"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { setProvider } from "@flue/runtime"
import { LM_STUDIO_UPSTREAM, type ModelCredential } from "@staffroom/protocol"
import {
  type ModelCredentialStore,
  getModelCredentialStore,
} from "../coordinator/model-credentials.ts"
import { fetchLmStudioModelCatalog, lmStudioProvider } from "./lm-studio.ts"
import { resolveCodexAccessToken } from "./openai-codex.ts"

/**
 * Turning stored credentials into Flue providers.
 *
 * Flue keeps **one runtime per process** and its provider registry is
 * module-scoped and keyed by id, so there is no such thing as "the current
 * tenant's provider" at the moment a model call happens — a job claimed from
 * the poll loop has no ambient anything. The way through is to make the
 * credential part of the provider's identity: every credential registers as
 * its own provider (`anthropic-org`, `anthropic-7f3a91c2b4d0`), and choosing
 * which one runs a turn happens at render, where the tenant is known.
 *
 * `setProvider` upserts by id, so an edited credential is a re-register.
 * Removal is the awkward one: Flue exports `setProvider` and nothing else, so
 * there is no reachable `deleteProvider` — see {@link unregisterCredentialProvider}.
 */

/** Provider ids we have registered in this process, so we can answer for them. */
const registered = new Set<string>()

// Built once: constructing every built-in provider is cheap but not free, and
// their catalogs never change within a process.
let builtins: Map<string, Provider> | undefined

function builtinFor(upstream: string): Provider | undefined {
  builtins ??= new Map(builtinProviders().map((provider) => [provider.id, provider]))
  return builtins.get(upstream)
}

/** Every upstream a credential may name, for the UI's picker. */
export function listUpstreams(): string[] {
  builtins ??= new Map(builtinProviders().map((provider) => [provider.id, provider]))
  // LM Studio is not a pi-ai built-in — it is constructed per credential from
  // the stored endpoint — but it is still an upstream a credential may name.
  return [...new Set([...builtins.keys(), LM_STUDIO_UPSTREAM])].sort()
}

/**
 * The model ids a built-in upstream can run, straight from pi-ai's catalog —
 * the same list the runtime resolves a turn against, so the picker only ever
 * offers models Flue can actually route (a hand-fetched id pi-ai does not know
 * would fail at turn time). Local servers are not built-ins; their models come
 * from the endpoint instead (see the credential route). Empty for an unknown
 * upstream.
 */
export function builtinModelIds(upstream: string): string[] {
  const models = builtinFor(upstream)?.getModels() ?? []
  return [...new Set(models.map((model) => model.id))]
}

/**
 * Register every stored credential. Called at boot, so a server that restarts
 * overnight comes back with the same providers its jobs were using.
 */
export async function registerStoredCredentials(
  store = getModelCredentialStore(),
): Promise<number> {
  let registered = 0
  for (const credential of store.listAcrossTenants()) {
    if (await registerCredentialProvider(credential, store)) registered += 1
  }
  return registered
}

/**
 * Register one credential as a provider. Returns false when its upstream is
 * not one pi-ai knows — a credential we cannot serve is a configuration
 * mistake to report, not a reason to fail the boot.
 */
export async function registerCredentialProvider(
  credential: ModelCredential,
  store = getModelCredentialStore(),
): Promise<boolean> {
  // A local server has no pi-ai built-in; it is constructed from the endpoint
  // the credential stores, one provider per credential just like the rest.
  if (credential.kind === "local") {
    let models
    try {
      models = await fetchLmStudioModelCatalog(credential.baseUrl, {
        apiKey: store.secretOf(credential.id)?.secret || undefined,
      })
    } catch (error) {
      console.warn(
        `[staffroom] could not load LM Studio models for "${credential.label}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    setProvider(
      lmStudioProvider({
        id: credential.providerId,
        name: `${localName(credential.upstream)} (${credential.label})`,
        baseUrl: credential.baseUrl,
        models,
        // A bare server accepts any bearer token, so a placeholder marks it
        // configured; a server behind LM Studio's API-key setting has a stored
        // key we send instead.
        auth: {
          apiKey: {
            name: credential.label,
            resolve: async () => ({
              auth: { apiKey: store.secretOf(credential.id)?.secret || "local" },
              source: credential.label,
            }),
          },
        },
      }),
    )
    registered.add(credential.providerId)
    // Register even if the server is currently down. Once it is up, opening
    // the credential's model list refreshes this provider with its catalog.
    return true
  }

  const base = builtinFor(credential.upstream)
  if (!base) {
    console.warn(
      `[staffroom] credential "${credential.label}" names unknown upstream "${credential.upstream}" — skipping`,
    )
    return false
  }

  // Spread rather than construct: the built-in already carries the base URL,
  // the model catalog and the stream behaviour, and all we are replacing is
  // who pays and what it is called.
  //
  // The catalog has to be re-stamped as well, and this is not obvious. A
  // `Model` carries its own `provider` field, and while Flue *finds* the model
  // through the registry key, pi-ai resolves auth from `model.provider`. Alias
  // only the provider and every turn authenticates against the built-in id
  // instead — which fails with "Provider is not configured: openai-codex" while
  // the aliased provider sits there perfectly registered.
  const models = base.getModels().map((model) => ({ ...model, provider: credential.providerId }))

  setProvider({
    ...base,
    id: credential.providerId,
    name: `${base.name} (${credential.label})`,
    getModels: () => models,
    auth: {
      apiKey: {
        name: credential.label,
        resolve: async () => {
          const apiKey = await resolveApiKey(credential, store)
          return apiKey ? { auth: { apiKey }, source: credential.label } : undefined
        },
      },
    },
  })
  registered.add(credential.providerId)
  return true
}

/**
 * Retire a deleted credential's provider.
 *
 * pi-ai's registry has `deleteProvider`, but Flue does not expose the registry
 * — `setProvider` is the whole public surface. So a retired provider is
 * replaced by one that resolves no credential: pi-ai treats a provider whose
 * `resolve()` returns undefined as unconfigured, so its models drop out of
 * `getAvailable()` and any turn naming one fails at auth instead of billing a
 * key that no longer exists.
 *
 * The residue is a dead provider id in the registry until the process
 * restarts, which is harmless — nothing can select it and nothing can pay with
 * it. Worth revisiting if Flue ever exports the registry.
 */
export function unregisterCredentialProvider(credential: ModelCredential): void {
  if (credential.kind === "local") {
    setProvider(
      lmStudioProvider({
        id: credential.providerId,
        name: `${localName(credential.upstream)} (removed)`,
        baseUrl: credential.baseUrl,
        auth: { apiKey: { name: "removed", resolve: async () => undefined } },
      }),
    )
    registered.delete(credential.providerId)
    return
  }

  const base = builtinFor(credential.upstream)
  if (!base) return
  setProvider({
    ...base,
    id: credential.providerId,
    name: `${base.name} (removed)`,
    auth: { apiKey: { name: "removed", resolve: async () => undefined } },
  })
  registered.delete(credential.providerId)
}

export function isRegistered(credential: ModelCredential): boolean {
  return registered.has(credential.providerId)
}

/** A display name for a local upstream id, e.g. `lm-studio` → "LM Studio". */
function localName(upstream: string): string {
  return upstream === LM_STUDIO_UPSTREAM ? "LM Studio" : upstream
}

/**
 * The key a turn actually authenticates with.
 *
 * An API key is returned as stored. A Codex import is an OAuth pair, so it is
 * refreshed on the way out and the refreshed tokens are written back — the
 * server owns the login from the moment it is imported, which is the point of
 * importing it rather than reading some laptop's home directory.
 */
async function resolveApiKey(
  credential: ModelCredential,
  store: ModelCredentialStore,
): Promise<string | undefined> {
  const stored = store.secretOf(credential.id)
  if (!stored) return undefined
  if (stored.kind === "api_key") return stored.secret
  return await resolveCodexAccessToken(credential.id, stored.secret, store)
}
