import { zValidator } from "@hono/zod-validator"
import { FILES_PAGE, FileVisibility } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getFilesStore } from "../coordinator/files.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Files over HTTP: the operator uploads and downloads, lists what they can see,
 * promotes to the shared space, and deletes their own. Promotion lives here and
 * nowhere else — only a human shares a file.
 *
 * Mounted at `/api/files`, so the paths here are relative — that keeps the type
 * (`FileRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator` (the input
 * types the client sees). Upload is the interesting case: a typed multipart form.
 */
const idParam = z.object({ id: z.string().min(1) })

export const fileRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ files: getFilesStore().list(tenantId) })
  })
  /**
   * One filtered, sorted page of the shared space — `{ files, total, labels }`.
   * A separate endpoint from the unpaged `/` (which the chat rail and CLI still
   * use whole), mirroring chat history's split. Filters and sort live in SQL so
   * paging spans the whole matching set, not a slice the client pre-filters.
   */
  .get(
    "/page",
    zValidator(
      "query",
      z.object({
        limit: z.string().optional(),
        offset: z.string().optional(),
        filter: z.enum(["all", "operator", "artifacts", "org"]).optional(),
        agent: z.string().optional(),
        label: z.string().optional(),
        q: z.string().optional(),
        sort: z.enum(["recent", "name"]).optional(),
      }),
    ),
    (context) => {
      const { tenantId } = context.get("caller")
      const { filter, agent, label, q, sort } = context.req.valid("query")
      const limit = Math.min(Number(context.req.query("limit")) || FILES_PAGE, 100)
      const offset = Math.max(Number(context.req.query("offset")) || 0, 0)
      return context.json(
        getFilesStore().page(tenantId, { filter, agent, label, q, sort, limit, offset }),
      )
    },
  )
  .post(
    "/",
    // A typed multipart upload: the file plus optional metadata. `File` is a
    // global in the Node target and the browser, so one schema validates both.
    zValidator(
      "form",
      z.object({
        file: z.instanceof(File),
        name: z.string().optional(),
        agent: z.string().optional(),
        messageId: z.string().optional(),
        /** A JSON array of topic labels, encoded as a string in the form. */
        labels: z.string().optional(),
      }),
    ),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { file, name, agent, messageId, labels } = context.req.valid("form")
      const bytes = Buffer.from(await file.arrayBuffer())
      const created = getFilesStore().create(
        tenantId,
        {
          name: name || file.name,
          contentType: file.type || "application/octet-stream",
          source: "operator",
          // A chat attachment is scoped to the agent it was sent to, so its
          // context rail can list just that agent's files.
          agent: agent || null,
          jobId: null,
          messageId: messageId ?? null,
          labels: parseLabels(labels),
        },
        bytes,
      )
      return context.json({ file: created }, 201)
    },
  )
  .get("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    const file = getFilesStore().get(tenantId, context.req.valid("param").id)
    if (!file) return context.json({ error: "unknown_file" }, 404)
    return context.json({ file })
  })
  .get("/:id/content", zValidator("param", idParam), async (context) => {
    const { tenantId } = context.get("caller")
    const { id } = context.req.valid("param")
    const file = getFilesStore().get(tenantId, id)
    const bytes = file ? await getFilesStore().bytes(tenantId, id) : undefined
    if (!file || !bytes) return context.json({ error: "unknown_file" }, 404)
    return context.body(new Uint8Array(bytes), 200, {
      "content-type": file.contentType,
      "content-disposition": contentDisposition(file.name),
    })
  })
  .post(
    "/:id/visibility",
    zValidator("param", idParam),
    zValidator("json", z.object({ visibility: FileVisibility })),
    (context) => {
      const { tenantId } = context.get("caller")
      const file = getFilesStore().setVisibility(
        tenantId,
        context.req.valid("param").id,
        context.req.valid("json").visibility,
      )
      if (!file) return context.json({ error: "unknown_file" }, 404)
      return context.json({ file })
    },
  )
  .post(
    "/:id/labels",
    zValidator("param", idParam),
    zValidator("json", z.object({ labels: z.array(z.string()) })),
    (context) => {
      const { tenantId } = context.get("caller")
      const file = getFilesStore().setLabels(
        tenantId,
        context.req.valid("param").id,
        context.req.valid("json").labels,
      )
      if (!file) return context.json({ error: "unknown_file" }, 404)
      return context.json({ file })
    },
  )
  .delete("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    if (!getFilesStore().remove(tenantId, context.req.valid("param").id)) {
      return context.json({ error: "unknown_file" }, 404)
    }
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<FileRoutes>`). */
export type FileRoutes = typeof fileRoutes

/**
 * A `content-disposition` value that survives non-ASCII filenames. HTTP header
 * values are ByteStrings (Latin-1), so a character like an em-dash throws when
 * set. RFC 6266 handles this: an ASCII-only `filename="..."` fallback for old
 * clients, plus `filename*=UTF-8''...` (RFC 5987, percent-encoded) that modern
 * browsers prefer and that carries the real name.
 */
function contentDisposition(name: string): string {
  // Strip quotes/backslashes and replace any non-ASCII char for the fallback.
  const ascii = name.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_")
  const encoded = encodeURIComponent(name)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** A multipart `labels` field: a JSON array string, or empty when absent. */
function parseLabels(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((label) => typeof label === "string") : []
  } catch {
    return []
  }
}
