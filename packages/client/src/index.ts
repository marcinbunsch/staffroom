import type { OperatorEvent } from "@staffroom/protocol"
import { type ClientOptions, makeContext } from "./http.ts"

import { attentionDomain } from "./domains/attention.ts"
import { chatsDomain } from "./domains/chats.ts"
import { dashboardsDomain } from "./domains/dashboards.ts"
import { filesDomain } from "./domains/files.ts"
import { integrationsDomain } from "./domains/integrations.ts"
import { jobsDomain } from "./domains/jobs.ts"
import { keysDomain } from "./domains/keys.ts"
import { memoryDomain } from "./domains/memory.ts"
import { modelsDomain } from "./domains/models.ts"
import { makeSubscribe, operatorDomain } from "./domains/operator.ts"
import { pushDomain } from "./domains/push.ts"
import { schedulesDomain } from "./domains/schedules.ts"
import { searchDomain } from "./domains/search.ts"
import { sessionDomain } from "./domains/session.ts"
import { skillsDomain } from "./domains/skills.ts"
import { spendDomain } from "./domains/spend.ts"
import { staffDomain } from "./domains/staff.ts"
import { teamsDomain } from "./domains/teams.ts"
import { toolsDomain } from "./domains/tools.ts"
import { toolsetsDomain } from "./domains/toolsets.ts"
import { widgetsDomain } from "./domains/widgets.ts"

export { ApiError } from "./http.ts"
export type { ClientOptions } from "./http.ts"
export * from "./types.ts"
export type { OperatorEvent }

/**
 * The Staffroom API client — the single home for every API mechanic (fetch, the
 * Hono RPC envelopes, error shaping, the SSE stream), consumed by the UI and the
 * CLI. Each domain lives in `domains/<name>.ts` as a factory over a shared
 * `DomainContext`; this module builds one context and composes them.
 *
 * Isomorphic: `baseUrl`/`headers`/`fetch` options mean the UI rides the
 * same-origin cookie while a CLI passes an origin and a bearer. Domains migrate
 * to the typed RPC path (`hc`) one at a time — `files` is there; the rest use the
 * shared `request` — with no change to the surface a caller sees.
 */
export function createClient(options: ClientOptions = {}) {
  const ctx = makeContext(options)
  return {
    files: filesDomain(ctx),
    staff: staffDomain(ctx),
    jobs: jobsDomain(ctx),
    attention: attentionDomain(ctx),
    schedules: schedulesDomain(ctx),
    widgets: widgetsDomain(ctx),
    dashboards: dashboardsDomain(ctx),
    models: modelsDomain(ctx),
    memory: memoryDomain(ctx),
    skills: skillsDomain(ctx),
    spend: spendDomain(ctx),
    integrations: integrationsDomain(ctx),
    tools: toolsDomain(ctx),
    search: searchDomain(ctx),
    toolsets: toolsetsDomain(ctx),
    chats: chatsDomain(ctx),
    teams: teamsDomain(ctx),
    keys: keysDomain(ctx),
    me: sessionDomain(ctx).me,
    operator: operatorDomain(ctx),
    push: pushDomain(ctx),
    subscribe: makeSubscribe(ctx),
  }
}

export type StaffroomClient = ReturnType<typeof createClient>
