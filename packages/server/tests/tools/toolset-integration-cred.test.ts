import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineTool } from "@flue/runtime"
import { addPlugin, definePlugin, resetPlugins } from "@staffroom/plugin-core"
import type { Toolset } from "@staffroom/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

/**
 * A plugin toolset that sets `usesIntegration` reuses an existing integration's
 * credentials rather than its own env config. The resolve context hands its
 * tools lazy accessors — `integrationSecret()` for the raw stored secret (e.g. a
 * GCP service-account JSON), `integrationBearer()` for a minted token. This is
 * what a "Firestore Extras" toolset uses to piggyback the GCP integration.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-toolset-cred-"))
process.env.STAFFROOM_HOME = home

const { getDatabase } = await import("../../src/coordinator/database.ts")
const { migrateToLatest } = await import("../../src/coordinator/migrations.ts")
const { getIntegrationStore } = await import("../../src/coordinator/integrations.ts")
const { getToolCredentialStore } = await import("../../src/coordinator/tool-credentials.ts")
const { getToolsetType } = await import("../../src/tools/toolset-types.ts")

const SERVICE_ACCOUNT = '{"type":"service_account","project_id":"demo","client_email":"x@y"}'

function toolset(overrides: Partial<Toolset> = {}): Toolset {
  return {
    name: "firestore-extras",
    label: "Firestore Extras",
    kind: "firestore-extras",
    integration: "gcp",
    tools: [],
    gatedTools: [],
    toolDescriptions: {},
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  }
}

const env = {
  base: { tenantId: "alice", agent: "devops", session: "alice:devops" },
  attention: {} as never,
}

/** Register a one-tool plugin kind whose tool returns `integrationSecret()`. */
function installSecretProbe(kind: string): void {
  addPlugin(
    definePlugin({
      id: kind,
      toolsetTypes: [
        {
          kind,
          usesIntegration: true,
          resolve: (_toolset, context) => ({
            tools: [
              defineTool({
                name: "read_secret",
                description: "Return the linked integration's stored secret.",
                run: async () => (await context.integrationSecret()) ?? "(none)",
              }),
            ],
          }),
        },
      ],
    }),
  )
}

beforeAll(async () => {
  await migrateToLatest(getDatabase())
  getIntegrationStore().put({
    name: "gcp",
    label: "Google Cloud",
    type: "gcp",
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    repos: [],
  })
  getToolCredentialStore().put(null, { scope: "org", tool: "gcp", secret: SERVICE_ACCOUNT })
})

afterEach(() => resetPlugins())
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("an integration-backed plugin toolset", () => {
  it("reads its linked integration's stored secret at call time", async () => {
    installSecretProbe("firestore-extras")
    const { entries } = getToolsetType("firestore-extras")!.resolve(toolset(), env)
    expect(await entries![0]!.call({})).toBe(SERVICE_ACCOUNT)
  })

  it("gets undefined when the toolset names no integration", async () => {
    installSecretProbe("firestore-extras")
    const { entries } = getToolsetType("firestore-extras")!.resolve(
      toolset({ integration: "" }),
      env,
    )
    expect(await entries![0]!.call({})).toBe("(none)")
  })
})
