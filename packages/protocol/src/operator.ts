import { z } from "zod"

/**
 * Who the operator is — the person this tenant's staff work for.
 *
 * Agents read Slack, GitHub, Notion, and mail full of names and handles, and
 * without this they cannot tell which of them is you — so a report about a pull
 * request waiting on someone ends with "if you're not Alex, this may not be
 * yours". This profile is the answer: prepended to every agent's system prompt
 * so the identity is present on every turn.
 *
 * It is per-tenant, because a tenant *is* the operator (see `tenancy.md`): each
 * account describes its own owner. And it is capped, because it is paid for on
 * every turn of every agent.
 */

export const OPERATOR_PROFILE_LIMIT = 4_000

export const OperatorProfile = z.object({
  text: z.string().max(OPERATOR_PROFILE_LIMIT),
  /** Null until it has been written for the first time. */
  updatedAt: z.string().nullable(),
})
export type OperatorProfile = z.infer<typeof OperatorProfile>

export const OperatorProfileInput = z.object({
  text: z.string().max(OPERATOR_PROFILE_LIMIT),
})
export type OperatorProfileInput = z.infer<typeof OperatorProfileInput>

/** Offered in the UI when nothing has been written yet. */
export const OPERATOR_PROFILE_TEMPLATE = `I am <your name>, <your role> at <your company>.

You can recognise me by:
- Slack: <@your-handle>, display name "<Your Name>"
- GitHub: <your-username>
- Email: <you@example.com>
- Notion: "<Your Name>"

What I care about:
- <the thing you want flagged first>
- <what you would rather not be told about>
`
