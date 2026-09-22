import { defineTool, useTool } from "@flue/runtime"
import * as v from "valibot"
import { getRosterStore } from "../coordinator/roster.ts"

/**
 * The roster, so an agent knows who is on the team, their role, and what each can do.
 *
 * `ask_agent` and `job_handoff` both name another agent, and an agent has no
 * other way to discover who exists — so without this it can only address peers
 * it happens to already know about. Tenant-scoped: an agent sees only its own
 * organization's roster.
 */
export function attachListStaffTool(context: { tenantId: string }): void {
  useTool(
    defineTool({
      name: "list_staff",
      description:
        "List the staff you can ask or hand off to: each member's role and tools. Use this when deciding who should do something.",
      input: v.object({}),
      run: async () => {
        const members = getRosterStore()
          .list(context.tenantId)
          .filter((member) => member.enabled)
        if (members.length === 0) return "No staff members yet."
        return members
          .map((member) => {
            const tools = member.tools.length > 0 ? member.tools.join(", ") : "none"
            const description = member.description || "No role description provided."
            return `- ${member.name} (${member.id}) — ${description} Tools: ${tools}`
          })
          .join("\n")
      },
    }),
  )
}
