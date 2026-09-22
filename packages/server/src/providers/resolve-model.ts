import type { StaffMember } from "@staffroom/protocol"
import {
  type ModelCredentialStore,
  getModelCredentialStore,
} from "../coordinator/model-credentials.ts"

export interface ResolvedModel {
  /** What `useModel()` is given: `<providerId>/<model>`. */
  model: string
  /** Which credential pays for the turn. Recorded on the audit row in M2. */
  credentialId: string
}

/**
 * Which credential runs this agent's turns, and therefore which provider.
 *
 * A staff row names a credential, or names none and falls back to the default
 * credential — that fallback is what lets an agent work on day one before
 * anyone has connected a personal key. The row stores a *bare* model id
 * (`gpt-5-codex`), because the provider half of a Flue model string is a
 * property of the credential, and a row that hard-coded it could not be
 * repointed at a different key without an edit.
 *
 * The model, likewise, resolves from the row, else the default credential's
 * chosen default model — no hard-coded id, which would rot the moment the
 * upstream rolled its lineup forward (as `gpt-5.5` did). An env override stays
 * for a headless deployment that wants to force one.
 *
 * Resolution happens at render, which is the same seam that binds tenant
 * identity — and the only one available to a job resumed from Flue's poll loop.
 */
export function resolveModelFor(
  member: StaffMember,
  store: ModelCredentialStore = getModelCredentialStore(),
): ResolvedModel | undefined {
  const fallback = store.defaultCredential()
  const credential = member.credentialId
    ? store.get(member.tenantId, member.credentialId)
    : fallback
  if (!credential) return undefined

  const model =
    bareModelId(member.model) ??
    credential.defaultModel ??
    fallback?.defaultModel ??
    bareModelId(process.env.STAFFROOM_DEFAULT_MODEL)
  if (!model) return undefined

  return { model: `${credential.providerId}/${model}`, credentialId: credential.id }
}

/**
 * The bare model id, with any provider namespace stripped.
 *
 * The provider half of a Flue model string belongs to the *credential*, and is
 * prepended above. A row's stored model is meant to be bare (`gpt-5.5`), but an
 * operator — or a UI that speaks fully-qualified refs like `openai-codex/gpt-5.5`
 * — may carry a namespace. Model ids have no `/`, so anything before the last
 * one is a namespace to drop; otherwise it would double up against the
 * credential's provider and resolve to nothing.
 */
function bareModelId(model: string | null | undefined): string | undefined {
  if (!model) return undefined
  const slash = model.lastIndexOf("/")
  return slash === -1 ? model : model.slice(slash + 1)
}

/**
 * What to tell the operator when nothing can run the turn. Says which of the
 * two cases it is, because the fixes are different: connect a credential, or
 * ask an admin for one.
 */
export function noCredentialMessage(member: StaffMember): string {
  if (member.credentialId) {
    return `${member.name} is set to use a model credential that no longer exists. Choose another in Settings.`
  }
  return `${member.name} has no model to run on. Set a default credential and model in Settings → Model credentials (or give this agent its own), or ask an admin to.`
}
