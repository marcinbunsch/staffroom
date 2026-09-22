/**
 * A tiny fuzzy matcher for the command palette — no dependency, just a score.
 *
 * `fuzzyScore(query, text)` returns a number when every character of the query
 * appears in `text` in order (a subsequence), and `null` when it doesn't. A
 * higher score is a better match: a contiguous run beats scattered hits, a hit
 * at a word boundary beats one mid-word, and a shorter target beats a longer
 * one. The absolute value is meaningless — it only orders results within a list.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return 0

  let score = 0
  let from = 0
  let prev = -2
  for (const ch of q) {
    const at = t.indexOf(ch, from)
    if (at === -1) return null
    // A character right after the previous match (a contiguous run) is worth far
    // more than one reached after a gap.
    score += at === prev + 1 ? 6 : 1
    // A match that starts a word — string start or after a separator — is the
    // kind of match a person means when they type an acronym or a prefix.
    if (at === 0 || /[\s/_\-.]/.test(t[at - 1] ?? "")) score += 4
    // A small toll for every character skipped to reach this one.
    score -= (at - from) * 0.1
    prev = at
    from = at + 1
  }
  // Nudge shorter texts ahead when scores are otherwise close.
  return score - t.length * 0.01
}
