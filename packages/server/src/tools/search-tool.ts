import { defineTool, useTool } from "@flue/runtime"
import * as v from "valibot"
import { getSearchIndex } from "../coordinator/search.ts"

/**
 * Keyword search over readable files. Agent memory has its own owner-scoped
 * archive tools. Every agent gets this without a credential.
 */
export interface SearchToolContext {
  tenantId: string
}

export function attachSearchTool(context: SearchToolContext): void {
  useTool(
    defineTool({
      name: "search",
      description:
        "Search readable files by keyword. Returns the best matches with a short snippet. Use memory_search for knowledge in your own external archive.",
      input: v.object({
        query: v.pipe(v.string(), v.minLength(1), v.description("Keywords to search for")),
      }),
      run: async ({ data }) => {
        const hits = getSearchIndex().search(context.tenantId, data.query, { limit: 10 })
        if (hits.length === 0) return `No matches for "${data.query}".`
        return hits
          .map((hit) => `- [${hit.kind}] ${hit.title} (${hit.refId})\n  ${hit.snippet}`)
          .join("\n")
      },
    }),
  )
}
