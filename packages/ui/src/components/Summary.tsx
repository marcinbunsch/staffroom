import { Markdown } from "./Markdown.tsx"

const PREVIEW_LIMIT = 150

/**
 * A long piece of agent writing — a job summary, a timeline note — shown as its
 * first line and expandable to the whole thing, rendered as markdown.
 *
 * Agents write summaries that run to paragraphs. Showing all of one on every
 * card makes a board unreadable, and showing it as raw text loses the lists and
 * links they wrote.
 */
export function Summary({ text }: { text: string }) {
  const full = text.trim()
  if (full === "") return null

  const preview = firstLine(full)
  if (preview.length >= full.length) {
    return (
      <div className="markdown summary-open">
        <Markdown>{full}</Markdown>
      </div>
    )
  }

  return (
    <details className="summary-block" onClick={(event) => event.stopPropagation()}>
      <summary title="Show the whole summary">{preview}</summary>
      <div className="markdown">
        <Markdown>{full}</Markdown>
      </div>
    </details>
  )
}

/**
 * The opening line, for the collapsed state. Leading markdown is stripped
 * because "- `cases` has 42 open issues" should preview as prose, not as a
 * broken list item.
 */
function firstLine(text: string): string {
  const line = (text.split("\n").find((candidate) => candidate.trim() !== "") ?? "")
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/^\d+\.\s+/, "")

  if (line.length <= PREVIEW_LIMIT) return line
  const cut = line.slice(0, PREVIEW_LIMIT)
  const lastSpace = cut.lastIndexOf(" ")
  return `${cut.slice(0, lastSpace > PREVIEW_LIMIT / 2 ? lastSpace : PREVIEW_LIMIT).trimEnd()}…`
}
