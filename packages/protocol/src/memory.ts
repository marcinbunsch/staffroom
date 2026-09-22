import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/** Durable knowledge owned by one agent and retrieved outside its prompt. */
export const AgentMemoryKind = z.enum(["fact", "decision", "lesson", "status", "reference"])
export const AgentMemoryStatus = z.enum(["active", "superseded", "retracted"])

export const AgentMemoryEntry = z.object({
  id: z.string(),
  tenantId: TenantId,
  /** The agent that owns this archive entry; never supplied by the model. */
  agent: AgentId,
  /** An optional named slot whose active value is replaced by an update. */
  key: z.string().min(1).max(160).nullable(),
  kind: AgentMemoryKind,
  title: z.string().min(1).max(240),
  body: z.string().min(1).max(4000),
  /** Lightweight retrieval labels, not a project ownership model. */
  contexts: z.array(z.string().min(1).max(80)).max(16),
  status: AgentMemoryStatus,
  version: z.number().int().positive(),
  supersedes: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AgentMemorySearchHit = AgentMemoryEntry.extend({
  snippet: z.string(),
  score: z.number(),
})

export type AgentMemoryKind = z.infer<typeof AgentMemoryKind>
export type AgentMemoryStatus = z.infer<typeof AgentMemoryStatus>
export type AgentMemoryEntry = z.infer<typeof AgentMemoryEntry>
export type AgentMemorySearchHit = z.infer<typeof AgentMemorySearchHit>
