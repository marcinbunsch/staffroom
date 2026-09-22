import type { FileRow } from "./api.ts"

/**
 * File predicates shared across every place a file is shown (the Files screen,
 * chat attachments, the agent sidebar), so "is this readable as text?" is
 * decided one way everywhere rather than re-typed per context.
 */

/** Whether a file's bytes are readable text worth previewing inline. */
export function isTextFile(file: Pick<FileRow, "name" | "contentType">): boolean {
  return (
    file.contentType.startsWith("text/") ||
    /\.(md|markdown|txt|json|csv|log|ya?ml|tsv)$/i.test(file.name) ||
    file.contentType === "application/json"
  )
}

/** Whether a text file should render as rich Markdown rather than raw monospace. */
export function isMarkdownFile(file: Pick<FileRow, "name" | "contentType">): boolean {
  return file.contentType === "text/markdown" || /\.(md|markdown)$/i.test(file.name)
}
