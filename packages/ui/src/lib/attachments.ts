import type { FileRow } from "./api.ts"
import { fileSize } from "./format.ts"

/**
 * Chat attachments ride *in the message body* — the only channel to the agent.
 * On send we append a reference block naming each uploaded file (id + type +
 * size); on display we split that block back out so the operator sees their
 * text with attachment chips, not the raw block, and the agent still gets the
 * ids to `read_file`.
 */
const ATTACHMENT_HEADER = "📎 Attached files (open with read_file):"
const ATTACHMENT_ID = /id:\s*([0-9a-f-]{36})/gi

/** Append the attachment reference block to a message body (or return it as-is). */
export function buildAttachmentBody(text: string, files: FileRow[]): string {
  if (files.length === 0) return text
  const lines = files.map(
    (file) => `- ${file.name} — ${file.contentType}, ${fileSize(file.size)} — id: ${file.id}`,
  )
  const block = [ATTACHMENT_HEADER, ...lines].join("\n")
  return text ? `${text}\n\n${block}` : block
}

/** Split a raw message into its visible text and the attached file ids. */
export function splitAttachments(raw: string): { text: string; ids: string[] } {
  const index = raw.indexOf(ATTACHMENT_HEADER)
  if (index === -1) return { text: raw, ids: [] }
  const block = raw.slice(index)
  const ids = [...block.matchAll(ATTACHMENT_ID)].map((match) => match[1] as string)
  return { text: raw.slice(0, index).trim(), ids }
}
