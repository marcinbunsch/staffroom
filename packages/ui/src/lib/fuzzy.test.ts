import { expect, it } from "vitest"
import { fuzzyScore } from "./fuzzy.ts"

it("matches a subsequence and rejects a non-subsequence", () => {
  expect(fuzzyScore("ac", "abc")).not.toBeNull()
  expect(fuzzyScore("ca", "abc")).toBeNull()
})

it("is case-insensitive", () => {
  expect(fuzzyScore("AB", "abcdef")).not.toBeNull()
})

it("an empty query matches anything", () => {
  expect(fuzzyScore("", "anything")).toBe(0)
})

it("ranks a contiguous prefix above a scattered match", () => {
  const prefix = fuzzyScore("fil", "files")
  const scattered = fuzzyScore("fil", "fox trail")
  expect(prefix).not.toBeNull()
  expect(scattered).not.toBeNull()
  expect(prefix!).toBeGreaterThan(scattered!)
})

it("ranks a word-boundary match above a mid-word one", () => {
  const boundary = fuzzyScore("s", "new schedule")
  const midWord = fuzzyScore("s", "files")
  expect(boundary!).toBeGreaterThan(midWord!)
})
