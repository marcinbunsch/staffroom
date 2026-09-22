import { describe, expect, it } from "vitest"
import { browsableTopics, isMachineLabel, normalizeLabels } from "../src/files.ts"

describe("isMachineLabel", () => {
  it("flags ISO dates and bare numbers", () => {
    expect(isMachineLabel("2026-09-06")).toBe(true)
    expect(isMachineLabel("2025")).toBe(true)
    expect(isMachineLabel("144")).toBe(true)
  })

  it("flags high-entropy id tokens, bare or prefixed", () => {
    expect(isMachineLabel("GUvggb1bdCPYKVgWy3Un")).toBe(true)
    expect(isMachineLabel("qeKsuGe9SLMDutRluAAy")).toBe(true)
    expect(isMachineLabel("room-a2vADHQC7hBlN6RFmUGo")).toBe(true)
  })

  it("keeps genuine human topics, including short prefixed ones", () => {
    expect(isMachineLabel("audio")).toBe(false)
    expect(isMachineLabel("incident-report")).toBe(false)
    expect(isMachineLabel("room-audio")).toBe(false)
    expect(isMachineLabel("pm-digest")).toBe(false)
  })
})

describe("browsableTopics", () => {
  it("keeps only topics that recur and read as human, sorted", () => {
    const counts = new Map([
      ["audio", 4],
      ["analysis", 2],
      ["one-off", 1], // used once — a per-file note, not a browse category
      ["2026-09-06", 3], // recurs, but machine-shaped
    ])
    expect(browsableTopics(counts)).toEqual(["analysis", "audio"])
  })

  it("returns nothing when no label recurs", () => {
    const counts = new Map([
      ["alpha", 1],
      ["beta", 1],
    ])
    expect(browsableTopics(counts)).toEqual([])
  })
})

describe("normalizeLabels", () => {
  it("trims, drops empties, and dedupes preserving order", () => {
    expect(normalizeLabels([" taxes ", "2025", "taxes", ""])).toEqual(["taxes", "2025"])
  })
})
