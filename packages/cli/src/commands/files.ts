import { readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { ApiError } from "@staffroom/client"
import { type Flags, flag } from "../args.ts"
import { openClient } from "../session.ts"

/**
 * `staffroom files <sub>` — operator file operations against the active account:
 * list, upload (the reason this exists), download, label, share/unshare, remove.
 * A thin shell over the client's `files` domain; the one thing it adds is the
 * disk edge — turning a path into an upload and bytes back into a file.
 */
export async function filesCommand(rest: string[], flags: Flags): Promise<number> {
  const [sub, ...args] = rest
  try {
    switch (sub) {
      case undefined:
      case "list":
      case "ls":
        return await list(flags)
      case "upload":
      case "up":
        return await upload(args, flags)
      case "download":
      case "get":
        return await download(args, flags)
      case "label":
        return await label(args, flags)
      case "share":
        return await setVisibility(args[0], "org", flags)
      case "unshare":
        return await setVisibility(args[0], "private", flags)
      case "rm":
      case "remove":
        return await remove(args, flags)
      default:
        console.error(`Unknown files subcommand "${sub}". Run \`staffroom files help\`.`)
        return 1
    }
  } catch (error) {
    console.error(describe(error))
    return 1
  }
}

async function list(flags: Flags): Promise<number> {
  const { client } = openClient(flag(flags.account))
  const wanted = flag(flags.label)
  const files = (await client.files.list()).filter(
    (file) => !wanted || file.labels.includes(wanted),
  )
  if (files.length === 0) {
    console.log(wanted ? `No files labelled "${wanted}".` : "No files.")
    return 0
  }
  for (const file of files) {
    const share = file.visibility === "org" ? "org" : "private"
    const labels = file.labels.length ? `  [${file.labels.join(", ")}]` : ""
    console.log(`${file.id}\t${humanSize(file.size)}\t${share}\t${file.name}${labels}`)
  }
  return 0
}

async function upload(args: string[], flags: Flags): Promise<number> {
  const paths = args
  if (paths.length === 0) {
    console.error("Usage: staffroom files upload <path...> [--agent <id>] [--label a,b] [--org]")
    return 1
  }
  const { client } = openClient(flag(flags.account))
  const agent = flag(flags.agent)
  const labels = parseLabels(flag(flags.label))
  const share = flags.org === true
  const name = flag(flags.name)

  for (const path of paths) {
    const bytes = readFileSync(path)
    // Node's global File; the server reads `.name`/`.type` off it, so set both.
    const file = new File([bytes], name ?? basename(path), { type: mimeOf(path) })
    const created = (await client.files.upload(file, { agent, labels })).file
    if (share) await client.files.setVisibility(created.id, "org")
    console.log(`${created.id}\t${humanSize(created.size)}\t${created.name}`)
  }
  return 0
}

async function download(args: string[], flags: Flags): Promise<number> {
  const [id] = args
  if (!id) {
    console.error("Usage: staffroom files download <id> [-o <path|dir>]")
    return 1
  }
  // The bytes route streams raw content, not JSON, so this fetches directly with
  // the account's key rather than going through a typed domain method.
  const { account } = openClient(flag(flags.account))
  const base = account.url.replace(/\/+$/, "")
  const response = await fetch(`${base}/api/files/${id}/content`, {
    headers: { "x-api-key": account.key },
  })
  if (!response.ok) throw new ApiError(response.status, `download failed (${response.status})`)

  const filename = filenameFrom(response.headers.get("content-disposition")) ?? id
  const target = resolveTarget(flag(flags.out), filename)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  console.log(`Saved ${target}`)
  return 0
}

async function label(args: string[], flags: Flags): Promise<number> {
  const [id, ...labels] = args
  if (!id) {
    console.error("Usage: staffroom files label <id> <label...>   (no labels clears them)")
    return 1
  }
  const { client } = openClient(flag(flags.account))
  const file = (await client.files.setLabels(id, labels)).file
  console.log(file.labels.length ? `Labels: ${file.labels.join(", ")}` : "Labels cleared.")
  return 0
}

async function setVisibility(
  id: string | undefined,
  visibility: "private" | "org",
  flags: Flags,
): Promise<number> {
  if (!id) {
    console.error(`Usage: staffroom files ${visibility === "org" ? "share" : "unshare"} <id>`)
    return 1
  }
  const { client } = openClient(flag(flags.account))
  await client.files.setVisibility(id, visibility)
  console.log(visibility === "org" ? "Shared with the org." : "Made private.")
  return 0
}

async function remove(args: string[], flags: Flags): Promise<number> {
  const [id] = args
  if (!id) {
    console.error("Usage: staffroom files rm <id>")
    return 1
  }
  const { client } = openClient(flag(flags.account))
  await client.files.remove(id)
  console.log(`Removed ${id}.`)
  return 0
}

/** A comma-separated `--label a,b,c` into a trimmed, non-empty list. */
function parseLabels(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)
}

/** Where to write a download: a file path, or a filename inside a directory. */
function resolveTarget(out: string | undefined, filename: string): string {
  if (!out) return filename
  try {
    if (statSync(out).isDirectory()) return join(out, filename)
  } catch {
    // out does not exist yet — treat it as the target file path.
  }
  return out
}

/** Pull `filename="…"` out of a Content-Disposition header, if present. */
function filenameFrom(header: string | null): string | undefined {
  const match = header?.match(/filename="?([^"]+)"?/)
  return match?.[1]
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const units = ["KB", "MB", "GB", "TB"]
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(size >= 10 || Number.isInteger(size) ? 0 : 1)}${units[unit]}`
}

/** A small extension→MIME map; anything unknown uploads as octet-stream. */
function mimeOf(path: string): string {
  const extension = extname(path).toLowerCase()
  return MIME[extension] ?? "application/octet-stream"
}

const MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".zip": "application/zip",
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.status})`
  return error instanceof Error ? error.message : String(error)
}
