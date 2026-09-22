import type { SearchHit, SearchKind } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"

/**
 * Keyword search over what an agent can read.
 *
 * An FTS5 virtual table the content stores keep current: the files store
 * indexes file text on write and drops it on delete. Searching is a single
 * `MATCH` with a `tenant_id` filter and a
 * `bm25()` ranking — no derived store beyond the index itself.
 *
 * FTS5 is not exposed through Kysely's typed builder, so this is the one store
 * that talks to the connection in raw SQL. The queries are small, fixed, and
 * fully parameterised.
 */
export class SearchIndex {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Add or replace a row's searchable text. Delete-then-insert; FTS5 has no upsert. */
  index(kind: SearchKind, refId: string, tenantId: string, title: string, body: string): void {
    this.#db.transaction(() => {
      this.#removeRaw(kind, refId)
      this.#db.connection
        .prepare(
          "INSERT INTO search_index (kind, ref_id, tenant_id, title, body) VALUES (?, ?, ?, ?, ?)",
        )
        .run(kind, refId, tenantId, title, body)
    })
  }

  remove(kind: SearchKind, refId: string): void {
    this.#removeRaw(kind, refId)
  }

  /**
   * The best matches for a query within one tenant, ranked by bm25 (ascending —
   * a lower score is a closer match). `kinds` narrows to files, memory, or
   * files.
   */
  search(
    tenantId: string,
    query: string,
    options: { kinds?: SearchKind[]; limit?: number } = {},
  ): SearchHit[] {
    const match = toMatchQuery(query)
    if (!match) return []
    const limit = clampLimit(options.limit)
    const kinds = options.kinds && options.kinds.length > 0 ? options.kinds : null

    const kindFilter = kinds ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : ""
    const rows = this.#db.connection
      .prepare(
        `SELECT kind, ref_id AS refId, tenant_id AS tenantId, title,
                snippet(search_index, 4, '[', ']', '…', 12) AS snippet,
                bm25(search_index) AS score
         FROM search_index
         WHERE search_index MATCH ? AND tenant_id = ?${kindFilter}
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(match, tenantId, ...(kinds ?? []), limit) as SearchHit[]
    return rows
  }

  #removeRaw(kind: string, refId: string): void {
    this.#db.connection
      .prepare("DELETE FROM search_index WHERE kind = ? AND ref_id = ?")
      .run(kind, refId)
  }
}

/**
 * Turn a user query into a safe FTS5 MATCH expression.
 *
 * A raw query can contain FTS5 operators (`"`, `*`, `AND`, `:`) that either
 * change the meaning or are a syntax error. Tokenising to alphanumeric runs and
 * quoting each term gives an implicit-AND phrase-per-term search that cannot be
 * written wrong — the same posture as the event matcher's equality-only rule.
 */
function toMatchQuery(query: string): string | undefined {
  const terms = query.match(/[\p{L}\p{N}]+/gu)
  if (!terms || terms.length === 0) return undefined
  return terms.map((term) => `"${term}"`).join(" ")
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return 20
  return Math.max(1, Math.min(100, Math.floor(limit)))
}

let index: SearchIndex | undefined

export function getSearchIndex(): SearchIndex {
  if (!index) index = new SearchIndex(getDatabase())
  return index
}
