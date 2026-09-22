/**
 * The router *types*, for the Hono RPC client (`@staffroom/client`). A type-only
 * barrel: importing it pulls no server runtime into a client's build, only the
 * per-router types the client infers its methods from. Kept narrow — the client
 * never imports the server's app entry (`app.ts`), which drags in the world.
 *
 * One `export type` per domain as it is converted to RPC.
 */
export type { MeRoutes } from "./api-routes.ts"
export type { KeyRoutes } from "./keys-routes.ts"
export type { FileRoutes } from "./file-routes.ts"
export type { JobRoutes } from "./job-routes.ts"
export type { AttentionRoutes } from "./attention-routes.ts"
export type { ScheduleRoutes } from "./schedule-routes.ts"
export type { WidgetRoutes } from "./widget-routes.ts"
export type { DashboardRoutes } from "./dashboard-routes.ts"
export type { TeamRoutes } from "./team-routes.ts"
export type { IntegrationRoutes } from "./integration-routes.ts"
export type { ModelCredentialRoutes } from "./credential-routes.ts"
export type { SearchRoutes } from "./search-routes.ts"
export type { StaffRoutes } from "./staff-routes.ts"
export type { ToolRoutes } from "./tool-routes.ts"
export type { SpendRoutes } from "./spend-routes.ts"
export type { ToolsetRoutes } from "./toolset-routes.ts"
export type { ChatRoutes } from "./chat-routes.ts"
export type { SkillRoutes } from "./skill-routes.ts"
export type { MemoryRoutes } from "./memory-routes.ts"
export type { OperatorProfileRoutes } from "./operator-profile-routes.ts"
export type { PushRoutes } from "./push-routes.ts"
