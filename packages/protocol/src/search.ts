import { z } from "zod"
import { TenantId } from "./identity.ts"

/**
 * Keyword search over files an agent can read. Agent memory has its own
 * owner-scoped archive index and is only reachable through memory tools.
 *
 * No embeddings yet: the Codex login grants none, and semantic search needs a
 * separate key or a local model neither of which is worth it before keyword
 * search has been used in anger. The interface leaves room for a vector backend
 * — "find what I wrote about the auth rewrite" is a paraphrase query and keyword
 * search misses paraphrase — but that is a later `kind` and a later index, not a
 * change here.
 */
export const SearchKind = z.enum(["file"])

export const SearchHit = z.object({
  kind: SearchKind,
  /** The id of the underlying file row. */
  refId: z.string(),
  tenantId: TenantId,
  title: z.string(),
  /** A short excerpt around the match. */
  snippet: z.string(),
  /** bm25 score; lower is a better match, so results sort ascending. */
  score: z.number(),
})

export type SearchKind = z.infer<typeof SearchKind>
export type SearchHit = z.infer<typeof SearchHit>
