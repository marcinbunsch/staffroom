import { NO_USAGE } from "@staffroom/protocol"
import type { AuditEventInput } from "@staffroom/protocol"
import { beforeEach, describe, expect, it } from "vitest"
import { AuditLog } from "../../src/coordinator/audit.ts"
import type { AuditSchema } from "../../src/coordinator/audit-schema.ts"
import { migrateAuditToLatest } from "../../src/coordinator/audit-schema.ts"
import { Database, openConnection } from "../../src/coordinator/database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeLog(): Promise<AuditLog> {
  const database = new Database<AuditSchema>(openConnection(":memory:"))
  await migrateAuditToLatest(database)
  return new AuditLog(database)
}

function turn(tenantId: string, overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    tenantId,
    actor: { kind: "agent", id: "devops" },
    agent: "devops",
    session: `${tenantId}:devops`,
    jobId: null,
    type: "model.turn",
    usage: {
      model: "claude-sonnet-5",
      credentialId: "anthropic-abc",
      tokensIn: 100,
      tokensOut: 20,
      cacheRead: 5,
      cacheWrite: 2,
      costTotal: 0.0015,
    },
    payload: {},
    ...overrides,
  }
}

defineTenantIsolationTests("audit log", async () => {
  const log = await makeLog()
  return {
    create: (tenantId, seed) => {
      log.record(turn(tenantId, { agent: seed, session: `${tenantId}:${seed}` }))
      return seed
    },
    read: (tenantId, agent) => log.query(tenantId, { agent })[0],
    list: (tenantId) => log.query(tenantId),
  }
})

describe("the audit log", () => {
  let log: AuditLog

  beforeEach(async () => {
    log = await makeLog()
  })

  it("stores usage as values, not a blob to parse later", () => {
    const recorded = log.record(turn("alice"))

    expect(recorded.usage).toEqual({
      model: "claude-sonnet-5",
      credentialId: "anthropic-abc",
      tokensIn: 100,
      tokensOut: 20,
      cacheRead: 5,
      cacheWrite: 2,
      costTotal: 0.0015,
    })
    expect(recorded.sequence).toBeGreaterThan(0)
  })

  it("reads back oldest-first, so the log reads like a transcript", () => {
    log.record(turn("alice", { payload: { n: 1 } }))
    log.record(turn("alice", { payload: { n: 2 } }))
    log.record(turn("alice", { payload: { n: 3 } }))

    expect(log.query("alice").map((event) => event.payload.n)).toEqual([1, 2, 3])
  })

  it("records an event with no cost at all", () => {
    const recorded = log.record(turn("alice", { type: "agent.start", usage: NO_USAGE }))
    expect(recorded.usage.costTotal).toBe(0)
  })

  it("filters by the columns it indexes", () => {
    log.record(turn("alice", { agent: "devops" }))
    log.record(turn("alice", { agent: "research" }))
    log.record(turn("alice", { agent: "research", type: "tool.call", usage: NO_USAGE }))

    expect(log.query("alice", { agent: "devops" })).toHaveLength(1)
    expect(log.query("alice", { type: "tool.call" })).toHaveLength(1)
  })

  it("filters by date range", () => {
    log.record(turn("alice"))
    const future = new Date(Date.now() + 60_000).toISOString()

    expect(log.query("alice", { since: future })).toHaveLength(0)
    expect(log.query("alice", { until: future })).toHaveLength(1)
  })

  describe("spend", () => {
    /**
     * The point of usage-as-columns: the spend page is a `GROUP BY`, not a
     * scan-and-parse over JSON.
     */
    it("totals a tenant's spend by agent", () => {
      log.record(turn("alice", { agent: "devops" }))
      log.record(turn("alice", { agent: "devops" }))
      log.record(turn("alice", { agent: "research" }))

      const rows = log.spend("alice", "agent")
      expect(rows).toHaveLength(2)
      const devops = rows.find((row) => row.key === "devops")
      expect(devops).toMatchObject({ turns: 2, tokensIn: 200, tokensOut: 40 })
      expect(devops?.costTotal).toBeCloseTo(0.003, 6)
    })

    it("totals by model and by credential", () => {
      log.record(turn("alice"))
      log.record(
        turn("alice", {
          usage: { ...turn("alice").usage, model: "gpt-5.5", credentialId: "openai-codex-xyz" },
        }),
      )

      expect(
        log
          .spend("alice", "model")
          .map((row) => row.key)
          .sort(),
      ).toEqual(["claude-sonnet-5", "gpt-5.5"])
      expect(log.spend("alice", "credential")).toHaveLength(2)
    })

    it("counts only priced turns, not lifecycle events", () => {
      log.record(turn("alice"))
      log.record(turn("alice", { type: "agent.start", usage: NO_USAGE }))
      log.record(turn("alice", { type: "tool.call", usage: NO_USAGE }))

      expect(log.spend("alice", "agent")[0]?.turns).toBe(1)
    })

    it("never totals another tenant's spend into mine", () => {
      log.record(turn("alice"))
      log.record(turn("bob"))
      log.record(turn("bob"))

      expect(log.spend("alice", "agent")[0]?.turns).toBe(1)
      expect(log.spend("bob", "agent")[0]?.turns).toBe(2)
    })

    // The admin view, and the only cross-tenant read in the class.
    it("splits by tenant for an admin", () => {
      log.record(turn("alice"))
      log.record(turn("bob"))

      const rows = log.spendAcrossTenants()
      expect(rows.map((row) => row.key).sort()).toEqual(["alice", "bob"])
    })

    it("bounds an admin total by date range", () => {
      log.record(turn("alice"))
      const future = new Date(Date.now() + 60_000).toISOString()

      expect(log.spendAcrossTenants({ since: future })).toHaveLength(0)
    })
  })
})
