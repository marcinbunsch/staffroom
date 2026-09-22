import type { AgentOverview, StaffFile } from "@staffroom/protocol"

/**
 * Row shapes the client returns. These mirror the protocol schemas; callers
 * validate by rendering, so they are structural types rather than re-declared
 * Zod. As each domain moves to the typed RPC client, its rows will come from the
 * route inference (as `FileRow` already does) and drop out of here.
 */

export interface Me {
  tenantId: string
  role: string
  /** A single-user server (the desktop app's local one): no teams, roles or sign-out. */
  singleUser: boolean
}

export interface StaffRow {
  id: string
  name: string
  description: string
  systemPrompt: string
  model: string | null
  credentialId: string | null
  tools: string[]
  session: string
}
export interface NewStaff {
  id: string
  name: string
  description?: string
  systemPrompt: string
  model?: string | null
  credentialId?: string | null
  tools?: string[]
}
export interface JobRow {
  id: number
  title: string
  state: string
  assigneeAgent: string | null
  originatorAgent: string
  parentId: number | null
  createdAt: string
  updatedAt: string
}
export interface JobEntryRow {
  id: number
  kind: string
  text: string
  timestamp: string
  actor: { kind: string; id?: string }
}
export interface JobDetailRow extends JobRow {
  instruction: string
  summary: string | null
  entries: JobEntryRow[]
  children: JobRow[]
}
export interface AttentionRow {
  id: string
  agent: string
  /** The session it was raised in — a chat session or a job session. */
  session: string
  kind: string
  title: string
  detail: string | null
  approvalId: string | null
  jobId: number | null
  createdAt: string
}
/** The file shape comes from the protocol contract (the RPC client infers it). */
export type FileRow = StaffFile
export type Timing =
  | { kind: "cron"; expression: string }
  | { kind: "interval"; seconds: number }
  | { kind: "once"; at: string }
export interface ScheduleRow {
  id: string
  title: string
  agent: string
  instruction: string
  timing: Timing
  catchUp: boolean
  deadlineSeconds: number | null
  reportMode: "always" | "on_request"
  enabled: boolean
  lastFiredAt: string | null
  completedAt: string | null
}
export interface NewSchedule {
  title: string
  agent: string
  instruction: string
  timing: Timing
  catchUp?: boolean
  deadlineSeconds?: number | null
  reportMode?: "always" | "on_request"
}
export interface AgentMemoryEntryRow {
  id: string
  agent: string
  key: string | null
  kind: "fact" | "decision" | "lesson" | "status" | "reference"
  title: string
  body: string
  contexts: string[]
  status: "active" | "superseded" | "retracted"
  version: number
  supersedes: string | null
  source: string
  createdAt: string
  updatedAt: string
}
export interface NewAgentMemoryEntry {
  id?: string
  key?: string
  expectedVersion?: number
  kind: AgentMemoryEntryRow["kind"]
  title: string
  body: string
  contexts?: string[]
}
export interface SkillRow {
  id: string
  scope: "agent" | "org"
  agent: string | null
  name: string
  description: string
  instructions: string
  allowedTools: string | null
  source: "agent" | "operator" | "admin"
  enabled: boolean
  createdAt: string
  updatedAt: string
}
export interface NewSkill {
  name: string
  description: string
  instructions: string
}
export interface ModelCredentialRow {
  id: string
  scope: string
  kind: string
  upstream: string
  label: string
  isDefault: boolean
  defaultModel: string | null
  hint: string
  baseUrl: string
}
export type SpendDimension = "agent" | "model" | "session" | "credential"
export interface SpendRow {
  key: string
  turns: number
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
  costTotal: number
}
export interface ConfigFieldRow {
  key: string
  label: string
  secret: boolean
  optional: boolean
  placeholder?: string
}
export interface ToolCatalogRow {
  name: string
  label: string
  description: string
  provisioning: string
  gated: boolean
  configFields: ConfigFieldRow[]
}
export interface SandboxRepoRow {
  name: string
  path: string
}
export type IntegrationKind = "oauth" | "mcp" | "docker" | "gcp" | "token"
export interface IntegrationRow {
  name: string
  kind: IntegrationKind
  label: string
  type: string
  scopes: string[]
  repos: SandboxRepoRow[]
  description: string
  configFields: ConfigFieldRow[]
  unlocks: string[]
  mcpUrl?: string
  /** oauth kind: the redirect URI to register with the provider. */
  redirectUri?: string
  configured: boolean
  connected: boolean
  /** Connected, but the provider rejected the token — needs reconnecting. */
  stale: boolean
}
/** The sandbox runtime behind docker-kind integrations, for the settings card. */
export interface SandboxImageStatusRow {
  daemon: boolean
  image: boolean
  tag: string
  build: { running: boolean; failed: boolean; log: string } | null
}
export interface IntegrationTypeRow {
  type: string
  kind: IntegrationKind
  label: string
  description: string
  configFields: ConfigFieldRow[]
  defaultScopes: string[]
  unlocks: string[]
  defaultMcpUrl?: string
}
export interface IntegrationInputBody {
  name: string
  label: string
  type: string
  scopes?: string[]
  repos?: SandboxRepoRow[]
  clientId?: string
  clientSecret?: string
  serviceAccount?: string
  apiKey?: string
  mcpUrl?: string
}
export interface ToolCredentialRow {
  id: string
  tool: string
  scope: "org" | "user" | "grant"
  tenantId: string | null
  hint: string
  createdAt: string
  updatedAt: string
}
export interface ToolsetRow {
  name: string
  label: string
  /** "mcp" | "sandbox" | a plugin-contributed kind. */
  kind: string
  url?: string
  transport?: string
  integration: string
  tools: string[]
  gatedTools: string[]
  toolDescriptions: Record<string, string>
  createdAt: string
  updatedAt: string
}
export interface ToolsetInputBody {
  label: string
  kind: string
  integration?: string
  url?: string
  transport?: string
  tools?: string[]
  gatedTools?: string[]
  toolDescriptions?: Record<string, string>
}
export interface ToolsetKindRow {
  kind: string
  label: string
  description: string
  usesUrl: boolean
  usesIntegration: boolean
  builtinForm: boolean
}
export interface McpDiscoveredToolRow {
  name: string
  description: string
}
export interface TeamRow {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  members: string[]
  grants: string[]
  integrationGrants: string[]
}
export interface ChatRow {
  id: number
  tenantId: string
  agent: string
  session: string
  title: string
  kind: "main" | "side"
  closedAt: string | null
  createdAt: string
  lastMessageAt: string | null
}
export interface TabChatRow extends ChatRow {
  unread: number
  active: boolean
}
export interface SearchHitRow {
  kind: string
  refId: string
  title: string
  snippet: string
}

export type { AgentOverview }
