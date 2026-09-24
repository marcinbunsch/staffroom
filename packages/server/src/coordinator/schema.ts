/**
 * The database's shape, as Kysely sees it.
 *
 * This is a *description* of the tables, not their definition — the migrations
 * in `migrations.ts` define them, and this is what makes queries against them
 * type-check. The two can drift, and the thing that catches it is the store
 * tests, which run every query against a freshly migrated database.
 *
 * Columns are snake_case here and camelCase in `@staffroom/protocol`,
 * deliberately: the wire contract is not the storage layout, and each store's
 * `rowTo…` translates once at the boundary.
 *
 * better-auth's own tables live in this file too but are absent here. It
 * migrates and queries them itself through its own Kysely instance; describing
 * them would only invite us to write queries it does not expect.
 */

import type { Generated } from "kysely"

export interface StaffTable {
  tenant_id: string
  id: string
  name: string
  description: string
  system_prompt: string
  model: string | null
  credential_id: string | null
  tools: string
  enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ModelCredentialTable {
  id: string
  scope: string
  tenant_id: string | null
  kind: string
  upstream: string
  label: string
  secret: string
  hint: string
  /** Endpoint for a `local` credential; "" for cloud ones. */
  base_url: string
  is_default: number
  /** The fallback model for agents naming none — set only on the default row. */
  default_model: string | null
  created_at: string
  updated_at: string
}

export interface JobTable {
  id: Generated<number>
  tenant_id: string
  title: string
  instruction: string
  state: string
  originator_agent: string
  originator_session: string
  assignee_agent: string | null
  parent_id: number | null
  depth: number
  awaited: number
  report_mode: string
  summary: string | null
  deadline_at: string | null
  on_overrun: string | null
  escalated_at: string | null
  attempts: number
  created_at: string
  updated_at: string
}

export interface JobEntryTable {
  id: Generated<number>
  job_id: number
  tenant_id: string
  ts: string
  actor_kind: string
  actor_id: string | null
  kind: string
  text: string
}

export interface ScheduleTable {
  id: string
  tenant_id: string
  title: string
  agent: string
  instruction: string
  /** JSON-encoded Timing. */
  timing: string
  catch_up: number
  enabled: number
  deadline_seconds: number | null
  report_mode: string
  last_fired_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface FileTable {
  id: string
  tenant_id: string
  name: string
  content_type: string
  size: number
  source: string
  visibility: string
  agent: string | null
  job_id: number | null
  message_id: string | null
  /** JSON-encoded string[] of topics. */
  labels: string
  created_at: string
}

export interface ToolCredentialTable {
  id: string
  tool: string
  scope: string
  tenant_id: string | null
  secret: string
  hint: string
  created_at: string
  updated_at: string
  /**
   * When set, the provider last rejected this stored token as unauthorized (a
   * 401), so it needs reconnecting. Null while the token is believed good;
   * cleared on a successful call or on reconnect. Only ever set on `user` rows.
   */
  stale_at: string | null
}

export interface ApprovalTable {
  id: string
  tenant_id: string
  job_id: number | null
  session: string
  agent: string
  tool: string
  arguments_hash: string
  summary: string
  state: string
  reason: string | null
  created_at: string
  answered_at: string | null
}

export interface AttentionTable {
  id: string
  tenant_id: string
  agent: string
  kind: string
  title: string
  detail: string | null
  status: string
  session: string
  job_id: number | null
  approval_id: string | null
  created_at: string
  resolved_at: string | null
}

export interface AgentMemoryTable {
  id: string
  tenant_id: string
  agent: string
  key: string | null
  kind: string
  title: string
  body: string
  contexts: string
  status: string
  version: number
  supersedes: string | null
  source: string
  created_at: string
  updated_at: string
}

export interface SkillTable {
  id: string
  scope: string
  tenant_id: string | null
  agent: string | null
  name: string
  description: string
  instructions: string
  allowed_tools: string | null
  source: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface ChatTable {
  id: Generated<number>
  tenant_id: string
  agent: string
  session: string
  title: string
  kind: string
  closed_at: string | null
  created_at: string
  last_message_at: string | null
  last_preview: string | null
}

export interface ChatUnreadTable {
  session: string
  tenant_id: string
  agent: string
  count: number
  updated_at: string
}

export interface IntegrationTable {
  name: string
  label: string
  type: string
  /** JSON-encoded string[] of OAuth scopes to request (oauth kind). */
  scopes: string
  /** JSON-encoded { name, path }[] of repos to mount (docker kind). */
  repos: string
  /** A custom MCP server URL (token kind); "" means use the type's default. */
  mcp_url: string
  created_at: string
  updated_at: string
}

export interface ToolsetTable {
  name: string
  label: string
  kind: string
  url: string
  transport: string
  integration: string
  /** JSON-encoded string[]. */
  tools: string
  /** JSON-encoded string[] — the enabled tools that require approval per call. */
  gated_tools: string
  /** JSON-encoded Record<string, string>. */
  tool_descriptions: string
  created_at: string
  updated_at: string
}

export interface TeamTable {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface TeamMemberTable {
  team_id: string
  user_id: string
}

export interface TeamGrantTable {
  team_id: string
  toolset: string
}

export interface TeamIntegrationGrantTable {
  team_id: string
  integration: string
}

export interface OperatorProfileTable {
  tenant_id: string
  text: string
  updated_at: string
}

export interface WidgetTable {
  id: string
  tenant_id: string
  agent_id: string
  key: string
  type: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

export interface DashboardTable {
  id: string
  tenant_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface DashboardItemTable {
  id: string
  dashboard_id: string
  widget_id: string
  x: number
  y: number
  w: number
  h: number
  created_at: string
}

export interface DeviceTokenTable {
  /** The push destination — an APNs device token, or a Web Push endpoint URL.
   * The primary key, so re-registering the same device is an upsert. */
  token: string
  tenant_id: string
  /** `ios` (APNs), `web` (Web Push), or `android` when FCM lands. */
  platform: string
  /** Web Push subscription keys `{ p256dh, auth }` as JSON; "" for APNs. */
  keys: string
  created_at: string
  updated_at: string
}

export interface Schema {
  staff: StaffTable
  model_credentials: ModelCredentialTable
  jobs: JobTable
  job_entries: JobEntryTable
  schedules: ScheduleTable
  files: FileTable
  tool_credentials: ToolCredentialTable
  approvals: ApprovalTable
  attention: AttentionTable
  agent_memory: AgentMemoryTable
  skills: SkillTable
  toolsets: ToolsetTable
  integrations: IntegrationTable
  chats: ChatTable
  chat_unread: ChatUnreadTable
  teams: TeamTable
  team_members: TeamMemberTable
  team_grants: TeamGrantTable
  team_integration_grants: TeamIntegrationGrantTable
  operator_profiles: OperatorProfileTable
  device_tokens: DeviceTokenTable
  widgets: WidgetTable
  dashboards: DashboardTable
  dashboard_items: DashboardItemTable
}
