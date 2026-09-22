import type { ModelCredential, StaffMember } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import type { ModelCredentialStore } from "../../src/coordinator/model-credentials.ts"
import { resolveModelFor } from "../../src/providers/resolve-model.ts"

const CREDENTIAL: ModelCredential = {
  id: "cred-1",
  scope: "user",
  tenantId: "tenant-1",
  kind: "codex_oauth",
  upstream: "openai-codex",
  label: "My Codex",
  isDefault: false,
  defaultModel: "gpt-5-codex",
  hint: "…abcd",
  baseUrl: "",
  providerId: "openai-codex-b20b7fc0fc09",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
}

function staff(model: string | null): StaffMember {
  return {
    tenantId: "tenant-1",
    id: "devops",
    name: "DevOps",
    description: "",
    systemPrompt: "",
    model,
    credentialId: "cred-1",
    tools: [],
    enabled: true,
    createdAt: CREDENTIAL.createdAt,
    updatedAt: CREDENTIAL.updatedAt,
  }
}

const store = {
  get: () => CREDENTIAL,
  defaultCredential: () => CREDENTIAL,
} as unknown as ModelCredentialStore

describe("resolveModelFor", () => {
  it("composes the credential's provider with a bare model id", () => {
    expect(resolveModelFor(staff("gpt-5.6-terra"), store)?.model).toBe(
      "openai-codex-b20b7fc0fc09/gpt-5.6-terra",
    )
  })

  it("strips a provider namespace the row may carry, so it does not double up", () => {
    // A row (or a UI speaking fully-qualified refs) stored `openai-codex/gpt-5.6-terra`.
    // The provider half belongs to the credential; keep only the bare id, or
    // Flue sees the model id `openai-codex/gpt-5.6-terra` and finds no such model.
    expect(resolveModelFor(staff("openai-codex/gpt-5.6-terra"), store)?.model).toBe(
      "openai-codex-b20b7fc0fc09/gpt-5.6-terra",
    )
  })

  it("falls back to the credential's default model when the row names none", () => {
    expect(resolveModelFor(staff(null), store)?.model).toBe("openai-codex-b20b7fc0fc09/gpt-5-codex")
  })
})
