/**
 * @staffroom/protocol — the single source of truth for every type that crosses
 * the wire (server ↔ CLI ↔ UI). Zod schemas here; the TypeScript type comes
 * from `z.infer`. Validate at the boundary, then trust it inside.
 *
 * Zero runtime dependencies beyond zod. Flue tool inputs are the deliberate
 * exception and use valibot — Flue's own convention, kept separate.
 */
export * from "./attention.ts"
export * from "./audit.ts"
export * from "./chats.ts"
export * from "./dashboards.ts"
export * from "./events.ts"
export * from "./files.ts"
export * from "./identity.ts"
export * from "./integrations.ts"
export * from "./jobs.ts"
export * from "./toolsets.ts"
export * from "./memory.ts"
export * from "./operator.ts"
export * from "./operator-events.ts"
export * from "./presence.ts"
export * from "./schedules.ts"
export * from "./search.ts"
export * from "./skills.ts"
export * from "./tools.ts"
export * from "./model-credentials.ts"
export * from "./staff.ts"
export * from "./teams.ts"
export * from "./widgets.ts"
