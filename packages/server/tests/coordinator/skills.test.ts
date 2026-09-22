import { MAX_ENABLED_SKILLS } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import { SkillExistsError, SkillsFullError, SkillsStore } from "../../src/coordinator/skills.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeStore(): Promise<SkillsStore> {
  return new SkillsStore(await migratedDatabase())
}

function input(name: string) {
  return { name, description: `does ${name}`, instructions: `how to ${name}` }
}

defineTenantIsolationTests("skills", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, name) =>
      store.writeAgentSkill(tenantId, "devops", input(name), "agent").name,
    read: (tenantId, name) => store.getForAgent(tenantId, "devops", name),
    list: (tenantId) => store.listForAgent(tenantId, "devops"),
    remove: (tenantId, name) => store.removeAgentSkill(tenantId, "devops", name),
  }
})

describe("skills", () => {
  it("writes an agent skill, active by default", async () => {
    const store = await makeStore()
    const skill = store.writeAgentSkill("alice", "devops", input("triage"), "agent")
    expect(skill).toMatchObject({
      scope: "agent",
      source: "agent",
      enabled: true,
      allowedTools: null,
    })
  })

  it("refuses a duplicate name within one agent", async () => {
    const store = await makeStore()
    store.writeAgentSkill("alice", "devops", input("triage"), "agent")
    expect(() => store.writeAgentSkill("alice", "devops", input("triage"), "agent")).toThrow(
      SkillExistsError,
    )
  })

  it("lets two agents have a skill of the same name", async () => {
    const store = await makeStore()
    store.writeAgentSkill("alice", "devops", input("triage"), "agent")
    expect(() => store.writeAgentSkill("alice", "research", input("triage"), "agent")).not.toThrow()
  })

  describe("the render set (agent shadows org)", () => {
    it("includes the org directory", async () => {
      const store = await makeStore()
      store.writeOrgSkill(input("house-style"))
      store.writeAgentSkill("alice", "devops", input("triage"), "agent")

      const names = store
        .forRender("alice", "devops")
        .map((s) => s.name)
        .sort()
      expect(names).toEqual(["house-style", "triage"])
    })

    it("shadows an org skill with the agent's own of the same name", async () => {
      const store = await makeStore()
      store.writeOrgSkill({ name: "report", description: "org", instructions: "org way" })
      store.writeAgentSkill(
        "alice",
        "devops",
        { name: "report", description: "mine", instructions: "my way" },
        "agent",
      )

      const rendered = store.forRender("alice", "devops")
      const report = rendered.filter((s) => s.name === "report")
      expect(report).toHaveLength(1) // never two of one name
      expect(report[0]?.instructions).toBe("my way")
    })

    it("omits disabled skills", async () => {
      const store = await makeStore()
      const skill = store.writeAgentSkill("alice", "devops", input("triage"), "agent")
      expect(store.forRender("alice", "devops")).toHaveLength(1)
      store.update("alice", "devops", skill.name, { enabled: false })
      expect(store.forRender("alice", "devops")).toHaveLength(0)
    })

    it("does not leak one tenant's agent skills into another's render", async () => {
      const store = await makeStore()
      store.writeAgentSkill("alice", "devops", input("secret-skill"), "agent")
      expect(store.forRender("bob", "devops")).toHaveLength(0)
    })
  })

  describe("allowedTools is admin-only", () => {
    it("is null on an agent-written skill", async () => {
      const store = await makeStore()
      const skill = store.writeAgentSkill("alice", "devops", input("triage"), "agent")
      expect(skill.allowedTools).toBeNull()
    })

    it("is honoured on an admin org skill", async () => {
      const store = await makeStore()
      const skill = store.writeOrgSkill({
        ...input("privileged"),
        allowedTools: "send_message http_request",
      })
      expect(skill).toMatchObject({ source: "admin", allowedTools: "send_message http_request" })
    })
  })

  describe("the enabled cap", () => {
    it("fails a write past the cap", async () => {
      const store = await makeStore()
      for (let i = 0; i < MAX_ENABLED_SKILLS; i++) {
        store.writeAgentSkill("alice", "devops", input(`skill-${i}`), "agent")
      }
      expect(() => store.writeAgentSkill("alice", "devops", input("one-more"), "agent")).toThrow(
        SkillsFullError,
      )
    })

    it("lets a write succeed after disabling one", async () => {
      const store = await makeStore()
      for (let i = 0; i < MAX_ENABLED_SKILLS; i++) {
        store.writeAgentSkill("alice", "devops", input(`skill-${i}`), "agent")
      }
      store.update("alice", "devops", "skill-0", { enabled: false })
      expect(() =>
        store.writeAgentSkill("alice", "devops", input("one-more"), "agent"),
      ).not.toThrow()
    })
  })

  it("edits a skill's instructions in place", async () => {
    const store = await makeStore()
    store.writeAgentSkill("alice", "devops", input("triage"), "operator")
    const updated = store.update("alice", "devops", "triage", { instructions: "a better way" })
    expect(updated?.instructions).toBe("a better way")
  })
})
