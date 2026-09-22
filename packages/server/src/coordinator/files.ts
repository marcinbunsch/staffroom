import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type EventEnvelopeInput,
  FILE_CREATED,
  FILE_SHARED,
  type FileInput,
  StaffFile,
  browsableTopics,
  normalizeLabels,
} from "@staffroom/protocol"
import { sql } from "kysely"
import { STAFFROOM_HOME } from "../core/config.ts"
import { type Database, getDatabase } from "./database.ts"
import { getEventBus } from "./event-bus.ts"
import type { FileTable } from "./schema.ts"
import { type SearchIndex, getSearchIndex } from "./search.ts"

/** How a file event reaches the bus. Injected so tests need no bus. */
export type FilePublish = (input: EventEnvelopeInput) => void

/**
 * Files: metadata in `staffroom.db`, bytes on disk at
 * `$STAFFROOM_HOME/files/<id>`, never in the row.
 *
 * The read is the same idiom as model credentials — mine, plus what the
 * organization shares (`tenant_id = me OR visibility = org`). Sharing is a
 * field, so promoting is a flip and un-sharing is the reverse; the owner stays
 * the owner and is the only one who can delete.
 *
 * Only a human promotes: an agent that wrote a team report cannot publish it
 * itself. That costs some unattended convenience and closes a leak path, so
 * `promote` is reachable only from the operator API, never from a tool.
 */
export class FilesStore {
  readonly #db: Database
  readonly #dir: string
  readonly #publish: FilePublish
  readonly #search: SearchIndex | undefined

  constructor(
    db: Database,
    options: { dir?: string; publish?: FilePublish; search?: SearchIndex } = {},
  ) {
    this.#db = db
    this.#dir = options.dir ?? join(STAFFROOM_HOME, "files")
    this.#publish = options.publish ?? (() => {})
    this.#search = options.search
    mkdirSync(this.#dir, { recursive: true })
  }

  /**
   * Everything this tenant may read: their own, plus the organization's.
   *
   * `label` narrows to files carrying that topic and `since` to files created
   * at or after an ISO timestamp — so "new files about X" is one call. Both
   * filter the mapped rows: labels are inline JSON, and the tenant read already
   * loads the row, so this stays a read until a label query proves slow.
   */
  list(tenantId: string, options: { label?: string; since?: string } = {}): StaffFile[] {
    return this.#db
      .all(this.#visible(tenantId).selectAll().orderBy("created_at", "desc"))
      .map(rowToFile)
      .filter((file) => {
        if (options.label && !file.labels.includes(options.label)) return false
        if (options.since && file.createdAt < options.since) return false
        return true
      })
  }

  /**
   * One page of the shared space, filtered and sorted in SQL so paging spans the
   * whole matching set rather than a pre-loaded slice. Mirrors chat history:
   * `{ files, total }` where `total` is the filtered count, so a `Pager` knows
   * how many pages there are. `labels` rides along — the Topics bar's chips
   * across the tenant's visible files, so the bar stays complete on any page.
   *
   * `q` is free-text search: the primary way to find a file. When present, the
   * FTS index ranks the matches by relevance and the other filters narrow that
   * set — search and the chips/selects refine one list. Without `q` this is the
   * plain SQL page.
   *
   * `label` matches the JSON labels column with a quote-anchored `LIKE`, so
   * `"tax"` never matches `"taxes"`; `normalizeLabels` keeps labels quote-free,
   * so the anchors are exact.
   */
  page(
    tenantId: string,
    query: {
      filter?: "all" | "operator" | "artifacts" | "org"
      agent?: string
      label?: string
      q?: string
      sort?: "recent" | "name"
      limit: number
      offset: number
    },
  ): { files: StaffFile[]; total: number; labels: string[] } {
    if (query.q?.trim()) return this.#searchPage(tenantId, query, query.q.trim())
    const filtered = this.#filtered(tenantId, query)
    const ordered =
      query.sort === "name"
        ? filtered.orderBy(sql`name collate nocase`, "asc").orderBy("id", "asc")
        : filtered.orderBy("created_at", "desc").orderBy("id", "asc")
    const files = this.#db
      .all(ordered.selectAll().limit(query.limit).offset(query.offset))
      .map(rowToFile)
    const count = this.#db.get<{ total: number }>(
      this.#filtered(tenantId, query).select((eb) => eb.fn.countAll<number>().as("total")),
    )
    return { files, total: count ? Number(count.total) : 0, labels: this.labels(tenantId) }
  }

  /**
   * A page ranked by full-text relevance. The FTS index returns the best matches
   * (bm25, capped), the other filters narrow that set, and paging is in memory —
   * the match set is small and relevance order can't be expressed in the offset
   * SQL. The index is owner-scoped, so search finds the caller's own files, not
   * another tenant's org-shared ones; widening it is a later index change.
   */
  #searchPage(
    tenantId: string,
    query: { filter?: string; agent?: string; label?: string; limit: number; offset: number },
    q: string,
  ): { files: StaffFile[]; total: number; labels: string[] } {
    const hits = this.#search?.search(tenantId, q, { kinds: ["file"], limit: 200 }) ?? []
    const rank = new Map(hits.map((hit, index) => [hit.refId, index]))
    if (rank.size === 0) return { files: [], total: 0, labels: this.labels(tenantId) }
    const matched = this.#db
      .all(
        this.#filtered(tenantId, query)
          .selectAll()
          .where("id", "in", [...rank.keys()]),
      )
      .map(rowToFile)
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    const files = matched.slice(query.offset, query.offset + query.limit)
    return { files, total: matched.length, labels: this.labels(tenantId) }
  }

  /**
   * The Topics bar's chips across this tenant's visible files: the recurring,
   * human-shaped topics (`browsableTopics`), not every string ever tagged. A
   * one-off note or a generated id stays on its file and in search but does not
   * flood the bar.
   */
  labels(tenantId: string): string[] {
    const rows = this.#db.all(this.#visible(tenantId).select("labels"))
    const counts = new Map<string, number>()
    for (const row of rows)
      for (const label of JSON.parse(row.labels ?? "[]"))
        counts.set(label, (counts.get(label) ?? 0) + 1)
    return browsableTopics(counts)
  }

  /** Everything this tenant may read: their own rows, plus the organization's. */
  #visible(tenantId: string) {
    return this.#db.qb
      .selectFrom("files")
      .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("visibility", "=", "org")]))
  }

  /** `#visible` narrowed by the Files-page filters — the base for page and count. */
  #filtered(
    tenantId: string,
    { filter, agent, label }: { filter?: string; agent?: string; label?: string },
  ) {
    let query = this.#visible(tenantId)
    if (filter === "operator") query = query.where("source", "=", "operator")
    if (filter === "artifacts")
      query = query.where("source", "=", "agent").where("agent", "is not", null)
    if (filter === "org") query = query.where("visibility", "=", "org")
    if (agent) query = query.where("agent", "=", agent)
    if (label) query = query.where("labels", "like", `%"${label}"%`)
    return query
  }

  get(tenantId: string, id: string): StaffFile | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("files")
        .selectAll()
        .where("id", "=", id)
        .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("visibility", "=", "org")])),
    )
    return row ? rowToFile(row) : undefined
  }

  /** The bytes of a file this tenant may read. */
  async bytes(tenantId: string, id: string): Promise<Buffer | undefined> {
    const file = this.get(tenantId, id)
    if (!file) return undefined
    return await readFile(join(this.#dir, id))
  }

  /** Write bytes and metadata, and announce it on the bus. Files start private. */
  create(tenantId: string, input: FileInput, bytes: Buffer | string): StaffFile {
    const id = randomUUID()
    const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes
    // Bytes first: a row pointing at a file that failed to write would be a lie.
    writeFileSync(join(this.#dir, id), buffer, { mode: 0o600 })

    const now = new Date().toISOString()
    const labels = normalizeLabels(input.labels ?? [])
    this.#db.run(
      this.#db.qb.insertInto("files").values({
        id,
        tenant_id: tenantId,
        name: input.name,
        content_type: input.contentType ?? "application/octet-stream",
        size: buffer.length,
        source: input.source,
        visibility: "private",
        agent: input.agent ?? null,
        job_id: input.jobId ?? null,
        message_id: input.messageId ?? null,
        labels: JSON.stringify(labels),
        created_at: now,
      }),
    )
    const file = this.#require(id)
    // Index text so it turns up in search. Binary bytes are not indexed — their
    // name still is, so an uploaded PDF is findable by filename.
    if (isText(file.contentType)) {
      this.#search?.index("file", id, tenantId, file.name, buffer.toString("utf8"))
    } else {
      this.#search?.index("file", id, tenantId, file.name, "")
    }
    this.#publish({
      type: FILE_CREATED,
      tenantId,
      source: `file:${id}`,
      payload: {
        fileId: id,
        name: file.name,
        source: file.source,
        visibility: "private",
        // Labels ride the event so a schedule can subscribe to "a new file
        // tagged invoices" and open a job — the M4/M5 bus loop.
        labels: file.labels,
      },
    })
    return file
  }

  /**
   * Promote a private file to org, or return it to private. Operator-only by
   * construction (no tool reaches this). Promoting announces an org-scoped
   * `file.shared` — the one place a file event crosses tenant lines.
   */
  setVisibility(
    tenantId: string,
    id: string,
    visibility: "private" | "org",
  ): StaffFile | undefined {
    // Only the owner, not an org reader, may change sharing — so this scopes to
    // tenant_id, not the shared read.
    const owned = this.#db.get(
      this.#db.qb
        .selectFrom("files")
        .selectAll()
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId),
    )
    if (!owned) return undefined
    this.#db.run(
      this.#db.qb
        .updateTable("files")
        .set({ visibility })
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId),
    )
    const file = this.#require(id)
    if (visibility === "org") {
      this.#publish({
        type: FILE_SHARED,
        tenantId,
        scope: "org",
        source: `file:${id}`,
        payload: { fileId: id, name: file.name, visibility: "org" },
      })
    }
    return file
  }

  /**
   * Replace a file's labels. Owner-only, like sharing — an org reader may see a
   * shared file but not retag it — so this scopes to `tenant_id`, not the shared
   * read. Returns the updated file, or undefined if the caller does not own it.
   */
  setLabels(tenantId: string, id: string, labels: string[]): StaffFile | undefined {
    const owned = this.#db.get(
      this.#db.qb
        .selectFrom("files")
        .select("id")
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId),
    )
    if (!owned) return undefined
    this.#db.run(
      this.#db.qb
        .updateTable("files")
        .set({ labels: JSON.stringify(normalizeLabels(labels)) })
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId),
    )
    return this.#require(id)
  }

  /** Delete a file the caller owns — bytes and row. Org readers cannot delete. */
  remove(tenantId: string, id: string): boolean {
    const owned = this.#db.get(
      this.#db.qb
        .selectFrom("files")
        .select("id")
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId),
    )
    if (!owned) return false
    this.#db.run(
      this.#db.qb.deleteFrom("files").where("id", "=", id).where("tenant_id", "=", tenantId),
    )
    rmSync(join(this.#dir, id), { force: true })
    this.#search?.remove("file", id)
    return true
  }

  #require(id: string): StaffFile {
    const row = this.#db.get(this.#db.qb.selectFrom("files").selectAll().where("id", "=", id))
    if (!row) throw new Error(`file "${id}" did not persist`)
    return rowToFile(row)
  }
}

function rowToFile(row: FileTable): StaffFile {
  return StaffFile.parse({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contentType: row.content_type,
    size: row.size,
    source: row.source,
    visibility: row.visibility,
    agent: row.agent ?? null,
    jobId: row.job_id ?? null,
    messageId: row.message_id ?? null,
    labels: JSON.parse(row.labels ?? "[]"),
    createdAt: row.created_at,
  })
}

/** Text whose bytes are worth indexing for search. */
function isText(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/markdown" ||
    contentType.endsWith("+json")
  )
}

let store: FilesStore | undefined

export function getFilesStore(): FilesStore {
  if (!store) {
    store = new FilesStore(getDatabase(), {
      publish: (input) => getEventBus().publish(input),
      search: getSearchIndex(),
    })
  }
  return store
}
