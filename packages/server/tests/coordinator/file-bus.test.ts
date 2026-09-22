import type { Subscription } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import { EventBus } from "../../src/coordinator/event-bus.ts"
import { ChatStore } from "../../src/coordinator/chats.ts"
import { FilesStore } from "../../src/coordinator/files.ts"
import { JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Files gave the bus its second and third event types. This closes the loop the
 * milestone is about: a file event flows through the same bus that schedules use,
 * with no new mechanism.
 */
describe("file events on the bus", () => {
  async function wired(subscriptions: Subscription[]) {
    const database = await migratedDatabase()
    const jobs = new JobsCoordinator(database)
    jobs.setDispatcher(() => {})
    const bus = new EventBus([() => subscriptions], jobs, new ChatStore(database))
    const dir = mkdtempSync(join(tmpdir(), "staffroom-filebus-"))
    const files = new FilesStore(database, { dir, publish: (input) => bus.publish(input) })
    return { jobs, bus, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  /**
   * The org-directory watcher of the plan's §5: an admin subscription that opens
   * a job whenever a file is shared to the organization.
   */
  it("opens a job when a file is shared to the org", async () => {
    const watcher: Subscription = {
      id: "watch:org-files",
      tenantId: "admin",
      match: { type: "file.shared" },
      agent: "librarian",
      title: "Catalog shared files",
      instruction: "Catalog the newly shared file.",
      cursor: null,
      enabled: true,
      deadlineSeconds: null,
      reportMode: "always",
    }
    const { jobs, files, cleanup } = await wired([watcher])
    try {
      const file = files.create("alice", { name: "team-report.md", source: "agent" }, "x")
      expect(jobs.list("admin")).toHaveLength(0) // create is tenant-scoped, admin does not see it

      files.setVisibility("alice", file.id, "org") // this crosses to org scope
      const opened = jobs.list("admin")
      expect(opened).toHaveLength(1)
      expect(opened[0]?.instruction).toBe("Catalog the newly shared file.")
    } finally {
      cleanup()
    }
  })

  it("a private file.created stays within its tenant", async () => {
    const otherTenantWatcher: Subscription = {
      id: "watch:files",
      tenantId: "bob",
      match: { type: "file.created" },
      agent: "devops",
      title: "React to files",
      instruction: "React.",
      cursor: null,
      enabled: true,
      deadlineSeconds: null,
      reportMode: "always",
    }
    const { jobs, files, cleanup } = await wired([otherTenantWatcher])
    try {
      files.create("alice", { name: "private.md", source: "agent" }, "x")
      // Bob's subscription must not see Alice's private file.
      expect(jobs.list("bob")).toHaveLength(0)
    } finally {
      cleanup()
    }
  })
})
