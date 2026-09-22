import { randomUUID } from "node:crypto"
import {
  MAX_ENABLED_SKILLS,
  Skill,
  type SkillInput,
  type SkillSource,
  type SkillUpdate,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { SkillTable } from "./schema.ts"

export class SkillExistsError extends Error {
  constructor(override readonly name: string) {
    super(`a skill named "${name}" already exists here`)
    this.name = "SkillExistsError"
  }
}

export class SkillsFullError extends Error {
  constructor(readonly limit: number) {
    super(`cannot enable more than ${limit} skills; disable one first`)
    this.name = "SkillsFullError"
  }
}

/**
 * Agent skills as rows.
 *
 * An agent writes into its own set and reads its own plus an org directory an
 * admin curates. The name-collision rule is resolved here, not left to Flue: an
 * agent skill and an org skill may share a name (an agent specialising the
 * house style), and {@link SkillsStore.forRender} returns agent-shadows-org so
 * the render never hands `useSkill()` two skills of one name — which it throws
 * on.
 *
 * `allowedTools` is accepted only from an admin. An agent-authored one would
 * route around the confirm-gates, so it is dropped on any non-admin write and
 * absent from the agent-facing tool.
 */
export class SkillsStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /**
   * The skills to mount for one agent's render: its own enabled skills, plus
   * the org directory's, with an agent skill shadowing an org skill of the same
   * name. Never two of one name.
   */
  forRender(tenantId: string, agent: string): Skill[] {
    const own = this.#db
      .all(
        this.#db.qb
          .selectFrom("skills")
          .selectAll()
          .where("scope", "=", "agent")
          .where("tenant_id", "=", tenantId)
          .where("agent", "=", agent)
          .where("enabled", "=", 1),
      )
      .map(rowToSkill)
    const org = this.#db
      .all(
        this.#db.qb
          .selectFrom("skills")
          .selectAll()
          .where("scope", "=", "org")
          .where("enabled", "=", 1),
      )
      .map(rowToSkill)

    const byName = new Map<string, Skill>()
    for (const skill of org) byName.set(skill.name, skill)
    for (const skill of own) byName.set(skill.name, skill) // agent shadows org
    return [...byName.values()]
  }

  /** An agent's own skills (for the agent's tools and the operator's screen). */
  listForAgent(tenantId: string, agent: string): Skill[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("skills")
          .selectAll()
          .where("scope", "=", "agent")
          .where("tenant_id", "=", tenantId)
          .where("agent", "=", agent)
          .orderBy("name", "asc"),
      )
      .map(rowToSkill)
  }

  /** The org directory. */
  listOrg(): Skill[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("skills")
          .selectAll()
          .where("scope", "=", "org")
          .orderBy("name", "asc"),
      )
      .map(rowToSkill)
  }

  getForAgent(tenantId: string, agent: string, name: string): Skill | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("skills")
        .selectAll()
        .where("scope", "=", "agent")
        .where("tenant_id", "=", tenantId)
        .where("agent", "=", agent)
        .where("name", "=", name),
    )
    return row ? rowToSkill(row) : undefined
  }

  /** Write an agent-scoped skill. `source` says who — an agent, or the operator. */
  writeAgentSkill(
    tenantId: string,
    agent: string,
    input: SkillInput,
    source: "agent" | "operator",
  ): Skill {
    if (this.getForAgent(tenantId, agent, input.name)) throw new SkillExistsError(input.name)
    this.#assertCapacity(tenantId, agent)
    return this.#insert({ scope: "agent", tenantId, agent, source, allowedTools: null, ...input })
  }

  /** Write an org-directory skill. Admin only; may set allowedTools. */
  writeOrgSkill(input: SkillInput & { allowedTools?: string | null }): Skill {
    const existing = this.#db.get(
      this.#db.qb
        .selectFrom("skills")
        .select("id")
        .where("scope", "=", "org")
        .where("name", "=", input.name),
    )
    if (existing) throw new SkillExistsError(input.name)
    return this.#insert({
      scope: "org",
      tenantId: null,
      agent: null,
      source: "admin",
      allowedTools: input.allowedTools ?? null,
      ...input,
    })
  }

  update(tenantId: string, agent: string, name: string, input: SkillUpdate): Skill | undefined {
    const skill = this.getForAgent(tenantId, agent, name)
    if (!skill) return undefined
    if (input.enabled && !skill.enabled) this.#assertCapacity(tenantId, agent)
    const merged = { ...skill, ...input }
    this.#db.run(
      this.#db.qb
        .updateTable("skills")
        .set({
          description: merged.description,
          instructions: merged.instructions,
          enabled: merged.enabled ? 1 : 0,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", skill.id),
    )
    return this.getForAgent(tenantId, agent, name)
  }

  removeAgentSkill(tenantId: string, agent: string, name: string): boolean {
    return (
      this.#db.run(
        this.#db.qb
          .deleteFrom("skills")
          .where("scope", "=", "agent")
          .where("tenant_id", "=", tenantId)
          .where("agent", "=", agent)
          .where("name", "=", name),
      ).changes > 0
    )
  }

  #assertCapacity(tenantId: string, agent: string): void {
    const row = this.#db.get<{ n: number }>(
      this.#db.qb
        .selectFrom("skills")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("scope", "=", "agent")
        .where("tenant_id", "=", tenantId)
        .where("agent", "=", agent)
        .where("enabled", "=", 1),
    )
    if ((row ? Number(row.n) : 0) >= MAX_ENABLED_SKILLS)
      throw new SkillsFullError(MAX_ENABLED_SKILLS)
  }

  #insert(fields: {
    scope: "agent" | "org"
    tenantId: string | null
    agent: string | null
    source: SkillSource
    allowedTools: string | null
    name: string
    description: string
    instructions: string
  }): Skill {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.#db.run(
      this.#db.qb.insertInto("skills").values({
        id,
        scope: fields.scope,
        tenant_id: fields.tenantId,
        agent: fields.agent,
        name: fields.name,
        description: fields.description,
        instructions: fields.instructions,
        allowed_tools: fields.allowedTools,
        source: fields.source,
        enabled: 1,
        created_at: now,
        updated_at: now,
      }),
    )
    const row = this.#db.get(this.#db.qb.selectFrom("skills").selectAll().where("id", "=", id))
    if (!row) throw new Error(`skill "${fields.name}" did not persist`)
    return rowToSkill(row)
  }
}

function rowToSkill(row: SkillTable): Skill {
  return Skill.parse({
    id: row.id,
    scope: row.scope,
    tenantId: row.tenant_id ?? null,
    agent: row.agent ?? null,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    allowedTools: row.allowed_tools ?? null,
    source: row.source,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

let store: SkillsStore | undefined

export function getSkillsStore(): SkillsStore {
  if (!store) store = new SkillsStore(getDatabase())
  return store
}
