import { SkillInput } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"

/**
 * The load-bearing guarantee: a skill row our schema accepts is one Flue will
 * mount without throwing. If they diverge, a stored row could pass the write
 * and then throw inside `useSkill()` — which fails *every* turn for that agent,
 * not just one that uses the skill.
 *
 * Flue's `normalizeSkillDefinition` requires: name 1..64 chars matching
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`; description 1..1024; non-empty instructions.
 * These cases pin our schema to those exact rules (copied from Flue's source,
 * `packages/runtime/src/skill-definition.ts`), so a change to either that lets
 * them drift fails here.
 */
const good = {
  name: "triage-incidents",
  description: "when an alert fires",
  instructions: "1. check the dashboard",
}

describe("the skill schema mirrors Flue's mount validation", () => {
  it("accepts a valid definition", () => {
    expect(SkillInput.safeParse(good).success).toBe(true)
  })

  it("accepts a 64-char name and a 1024-char description (the boundaries)", () => {
    expect(SkillInput.safeParse({ ...good, name: "a".repeat(64) }).success).toBe(true)
    expect(SkillInput.safeParse({ ...good, description: "d".repeat(1024) }).success).toBe(true)
  })

  const rejected: [string, Record<string, unknown>][] = [
    ["an uppercase name", { ...good, name: "Triage" }],
    ["an underscore in the name", { ...good, name: "triage_incidents" }],
    ["a leading hyphen", { ...good, name: "-triage" }],
    ["a double hyphen", { ...good, name: "triage--incidents" }],
    ["a name over 64 chars", { ...good, name: "a".repeat(65) }],
    ["an empty name", { ...good, name: "" }],
    ["an empty description", { ...good, description: "" }],
    ["a description over 1024 chars", { ...good, description: "d".repeat(1025) }],
    ["empty instructions", { ...good, instructions: "" }],
  ]

  for (const [why, def] of rejected) {
    it(`rejects ${why}`, () => {
      expect(SkillInput.safeParse(def).success).toBe(false)
    })
  }
})
