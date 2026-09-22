import { type SessionIdentity, type StaffMember, parseSessionKey } from "@staffroom/protocol"
import type { ModelCredentialStore } from "../coordinator/model-credentials.ts"
import type { RosterStore } from "../coordinator/roster.ts"
import { getModelCredentialStore } from "../coordinator/model-credentials.ts"
import { getRosterStore } from "../coordinator/roster.ts"
import { noCredentialMessage, resolveModelFor } from "../providers/resolve-model.ts"

/**
 * Everything a turn needs, derived from the session key and nothing else.
 *
 * This is the load-bearing claim of the whole tenancy design, so it is a pure
 * function rather than a few lines inside the render. Flue claims submissions
 * from a poll loop: a job resumed after a restart renders with no request, no
 * headers and no async context. The tenant therefore has to be recoverable from
 * the session key alone — and "alone" is a property you can only really check
 * if the code that does it takes nothing else.
 *
 * The signature is the test. There is no ambient input to accidentally depend
 * on, so a resumed turn and a live one cannot diverge.
 */
export type SessionResolution =
  | { kind: "invalid-session"; message: string }
  | { kind: "unknown-member"; message: string }
  | { kind: "no-credential"; message: string }
  | {
      kind: "ready"
      identity: SessionIdentity
      member: StaffMember
      model: string
      credentialId: string
    }

export interface SessionStores {
  roster: Pick<RosterStore, "get">
  credentials: ModelCredentialStore
}

export function resolveAgentSession(
  sessionKey: string,
  stores: SessionStores = { roster: getRosterStore(), credentials: getModelCredentialStore() },
): SessionResolution {
  const identity = parseSessionKey(sessionKey)
  if (!identity) {
    // The route guard refuses an unparseable key long before admission, so
    // reaching here means something dispatched internally with a malformed
    // key — a bug worth saying out loud rather than answering around.
    return {
      kind: "invalid-session",
      message: `This session id ("${sessionKey}") is not a valid Staffroom session.`,
    }
  }

  const member = stores.roster.get(identity.tenantId, identity.agentId)
  if (!member) {
    // The roster guard rejects unknown agents before admission, so this is a
    // member removed mid-conversation.
    return { kind: "unknown-member", message: `There is no staff member "${identity.agentId}".` }
  }

  // Which credential pays decides which provider runs the turn, so the model
  // string is resolved per render rather than stored on the row.
  const resolved = resolveModelFor(member, stores.credentials)
  if (!resolved) return { kind: "no-credential", message: noCredentialMessage(member) }

  return {
    kind: "ready",
    identity,
    member,
    model: resolved.model,
    credentialId: resolved.credentialId,
  }
}
