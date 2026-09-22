import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * One file concept, from the start.
 *
 * The prototype had two things — operator-uploaded files and agent-produced
 * artifacts — that were the same durable, visible object travelling in opposite
 * directions. This collapses them: a file has metadata here and bytes on disk
 * at `$STAFFROOM_HOME/files/<id>`, and a `source` records where it came from.
 * There is no separate artifact store and no text-only limitation.
 */
export const FileSource = z.enum(["operator", "agent", "job"])

/** Sharing is a field, not a copy. One file, one version; un-sharing is a flip. */
export const FileVisibility = z.enum(["private", "org"])

/** How many files a single page of the shared space holds, like `CHAT_HISTORY_PAGE`. */
export const FILES_PAGE = 20

export const StaffFile = z.object({
  id: z.string(),
  tenantId: TenantId,
  name: z.string().min(1),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  source: FileSource,
  visibility: FileVisibility,
  /** Who produced it, for an agent- or job-sourced file. */
  agent: AgentId.nullable(),
  jobId: z.number().int().nullable(),
  /** The message it was attached to, for an operator upload into a chat. */
  messageId: z.string().nullable(),
  /**
   * Free-text topics, modelled on `agent_memory.contexts`: a file is `taxes`
   * and `2025` and `client-acme` at once, so retrieval is a query, not a folder
   * walk. Many-to-many by nature; a single-parent tree cannot express it.
   */
  labels: z.array(z.string()),
  createdAt: z.string(),
})

/**
 * An artifact is a durable file produced directly by an agent. It is stored,
 * shared, downloaded, and searched exactly like any other file; this type
 * makes its provenance explicit without introducing a second file store.
 */
export const Artifact = StaffFile.extend({
  source: z.literal("agent"),
  agent: AgentId,
})

export const FileInput = z.object({
  name: z.string().min(1).max(255),
  contentType: z.string().default("application/octet-stream"),
  source: FileSource,
  agent: AgentId.nullable().default(null),
  jobId: z.number().int().nullable().default(null),
  messageId: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
})

export type FileSource = z.infer<typeof FileSource>
export type FileVisibility = z.infer<typeof FileVisibility>
export type StaffFile = z.infer<typeof StaffFile>
export type Artifact = z.infer<typeof Artifact>
export type FileInput = z.input<typeof FileInput>

/** Whether a file is an agent-produced artifact rather than an upload or job output. */
export function isArtifact(file: StaffFile): file is Artifact {
  return file.source === "agent" && file.agent !== null
}

/**
 * Tidy a set of labels: trim, drop the empty, dedupe (first wins), preserve
 * order. The one place every write path — upload, tool, relabel — agrees on
 * what a label set is, so a filter can match by plain equality.
 */
export function normalizeLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

/**
 * How many files must carry a label before it earns a chip in the Topics bar.
 * A label used on a single file is a per-file note, not a browse category, so it
 * stays on the row and stays searchable — it just does not clutter the bar. The
 * bar is for topics you'd actually browse by, which recur by nature.
 */
export const MIN_TOPIC_FILES = 2

/**
 * A label that reads as a machine identifier rather than a human topic — an ISO
 * date, a bare number, or a high-entropy id token (`room-a2vADHQC7hBlN6RFmUGo`,
 * `GUvggb1bdCPYKVgWy3Un`). Agents used to echo context ids into labels, which
 * flooded the Topics bar; these never belong there. Labels can still hold them —
 * filtering by one still works — they are only kept out of the browse bar.
 */
export function isMachineLabel(label: string): boolean {
  const text = label.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true // ISO date, e.g. 2026-09-06
  if (/^\d+$/.test(text)) return true // a bare number or year
  // A long token that mixes upper, lower, and digits reads as a generated id.
  // Check the whole label and the tail after a `prefix-` (e.g. `room-<id>`).
  const tail = text.includes("-") ? text.slice(text.lastIndexOf("-") + 1) : text
  return looksLikeId(text) || looksLikeId(tail)
}

function looksLikeId(token: string): boolean {
  return token.length >= 16 && /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token)
}

/**
 * The Topics bar's chips, from a label → file-count map: the recurring,
 * human-shaped topics, sorted. Everything a file was tagged with still lives on
 * the row and in search; this is only what's worth browsing by.
 */
export function browsableTopics(counts: Map<string, number>): string[] {
  const out: string[] = []
  for (const [label, count] of counts) {
    if (count < MIN_TOPIC_FILES || isMachineLabel(label)) continue
    out.push(label)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** Event types the file store publishes onto the bus. */
export const FILE_CREATED = "file.created"
export const FILE_SHARED = "file.shared"
