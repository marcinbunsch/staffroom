import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * A staff member is a row, not code. A name, a system prompt, an optional
 * model and a list of tool grants — so adding an agent is an insert, and one
 * generic Flue agent function becomes whichever member a conversation
 * addresses.
 *
 * Every member belongs to exactly one tenant. Two people may both have an
 * agent called `devops`; they are different rows and different sessions, and
 * nothing in the system ever needs to disambiguate them by name alone.
 */
export const StaffMember = z.object({
  tenantId: TenantId,
  id: AgentId,
  name: z.string().min(1).max(120),
  /** A short, shareable statement of this agent's role for its colleagues. */
  description: z.string().max(280).default(""),
  systemPrompt: z.string(),
  /**
   * A bare model id (`gpt-5.5`, `claude-sonnet-5`), not `provider/model`. The
   * provider comes from the credential, resolved at render — see
   * {@link StaffMember.credentialId}.
   */
  model: z.string().nullable(),
  /**
   * Which credential pays for this agent's turns. Null means the organization's
   * default credential, which is how an agent works on day one with no
   * per-user setup.
   */
  credentialId: z.string().nullable(),
  tools: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const StaffMemberInput = StaffMember.pick({
  id: true,
  name: true,
  description: true,
  systemPrompt: true,
}).extend({
  model: z.string().nullable().optional(),
  credentialId: z.string().nullable().optional(),
  tools: z.array(z.string()).default([]),
})

export const StaffMemberUpdate = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(280),
    systemPrompt: z.string(),
    model: z.string().nullable(),
    credentialId: z.string().nullable(),
    tools: z.array(z.string()),
    enabled: z.boolean(),
  })
  .partial()

export type StaffMember = z.infer<typeof StaffMember>
export type StaffMemberInput = z.input<typeof StaffMemberInput>
export type StaffMemberUpdate = z.infer<typeof StaffMemberUpdate>
