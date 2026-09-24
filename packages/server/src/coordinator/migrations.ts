import { sql } from "kysely"
import type { Kysely } from "kysely"
import { type Migration, Migrator } from "kysely/migration"
import type { Database } from "./database.ts"

/**
 * Schema, versioned.
 *
 * Every store used to migrate itself in its constructor with
 * `CREATE TABLE IF NOT EXISTS`, and a schema change went in as a
 * `PRAGMA table_info` check guarding an `ALTER TABLE`. That works right up
 * until it doesn't: it is unversioned, order-dependent between stores, and
 * impossible to test as a sequence. The prototype is the cautionary tale —
 * its roster store ended up with hand-rolled data fixups embedded in a
 * constructor, running on every boot forever.
 *
 * So: an ordered, named list, applied once and recorded. Kysely's `Migrator`
 * keeps the bookkeeping table; we keep the migrations in code rather than in
 * files because the server ships as a single bundle and a directory of `.js`
 * to read at runtime would not survive it.
 *
 * **Migrations are append-only.** Once a name here has run anywhere, its
 * contents are history. Change the schema by adding the next one.
 */
export const migrations: Record<string, Migration> = {
  "001-staff": {
    async up(db: Kysely<never>) {
      // (tenant_id, id) is the key, so one tenant's `devops` and another's are
      // different rows and neither can shadow the other.
      await db.schema
        .createTable("staff")
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("id", "text", (column) => column.notNull())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("system_prompt", "text", (column) => column.notNull())
        .addColumn("model", "text")
        .addColumn("credential_id", "text")
        .addColumn("tools", "text", (column) => column.notNull())
        .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
        .addColumn("sort_order", "integer", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .addPrimaryKeyConstraint("staff_pk", ["tenant_id", "id"])
        .execute()
    },
  },

  "002-model-credentials": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("model_credentials")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("scope", "text", (column) => column.notNull())
        .addColumn("tenant_id", "text")
        .addColumn("kind", "text", (column) => column.notNull())
        .addColumn("upstream", "text", (column) => column.notNull())
        .addColumn("label", "text", (column) => column.notNull())
        .addColumn("secret", "text", (column) => column.notNull())
        .addColumn("hint", "text", (column) => column.notNull())
        .addColumn("is_default", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      await db.schema
        .createIndex("model_credentials_tenant")
        .on("model_credentials")
        .column("tenant_id")
        .execute()

      // At most one organization default, enforced by the schema rather than
      // by everyone remembering to clear the old one.
      await db.schema
        .createIndex("model_credentials_one_default")
        .on("model_credentials")
        .column("is_default")
        .unique()
        .where("is_default", "=", 1)
        .execute()
    },
  },

  "003-jobs": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("jobs")
        .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("instruction", "text", (column) => column.notNull())
        .addColumn("state", "text", (column) => column.notNull())
        .addColumn("originator_agent", "text", (column) => column.notNull())
        .addColumn("originator_session", "text", (column) => column.notNull())
        .addColumn("assignee_agent", "text")
        .addColumn("parent_id", "integer")
        .addColumn("depth", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("awaited", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("summary", "text")
        // Deadlines from the first migration, not bolted on: M7's confirm-gates
        // cancel a pending approval when a job's deadline expires, so the
        // column is a dependency rather than a later nicety.
        .addColumn("deadline_at", "text")
        .addColumn("on_overrun", "text")
        .addColumn("escalated_at", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      await db.schema
        .createTable("job_entries")
        .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
        .addColumn("job_id", "integer", (column) => column.notNull())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("ts", "text", (column) => column.notNull())
        .addColumn("actor_kind", "text", (column) => column.notNull())
        .addColumn("actor_id", "text")
        .addColumn("kind", "text", (column) => column.notNull())
        .addColumn("text", "text", (column) => column.notNull())
        .execute()

      // Every list is by tenant; the assignee index serves "jobs @devops holds".
      await db.schema
        .createIndex("jobs_tenant_assignee")
        .on("jobs")
        .columns(["tenant_id", "assignee_agent"])
        .execute()
      await db.schema.createIndex("jobs_parent").on("jobs").column("parent_id").execute()
      // The deadline sweep's exact predicate: pending, not-yet-escalated, due.
      await db.schema
        .createIndex("jobs_deadline")
        .on("jobs")
        .columns(["escalated_at", "deadline_at"])
        .execute()
      await db.schema.createIndex("job_entries_job").on("job_entries").column("job_id").execute()
    },
  },

  "004-routines": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("routines")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("instruction", "text", (column) => column.notNull())
        .addColumn("schedule", "text", (column) => column.notNull())
        .addColumn("catch_up", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
        .addColumn("deadline_seconds", "integer")
        .addColumn("last_fired_at", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      await db.schema.createIndex("routines_tenant").on("routines").column("tenant_id").execute()
    },
  },

  "005-files": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("files")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("content_type", "text", (column) => column.notNull())
        .addColumn("size", "integer", (column) => column.notNull())
        .addColumn("source", "text", (column) => column.notNull())
        .addColumn("visibility", "text", (column) => column.notNull().defaultTo("private"))
        .addColumn("agent", "text")
        .addColumn("job_id", "integer")
        .addColumn("message_id", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .execute()

      // "mine, plus what the org shares" is the read; both halves index here.
      await db.schema.createIndex("files_tenant").on("files").column("tenant_id").execute()
      await db.schema.createIndex("files_visibility").on("files").column("visibility").execute()
    },
  },

  "006-tool-credentials": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("tool_credentials")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tool", "text", (column) => column.notNull())
        .addColumn("scope", "text", (column) => column.notNull())
        .addColumn("tenant_id", "text")
        .addColumn("secret", "text", (column) => column.notNull())
        .addColumn("hint", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      // One org credential per tool; one per-user row per (tool, scope, user),
      // where scope distinguishes a stored token from an access grant. Partial
      // unique indexes keep both true in the schema rather than by care.
      await db.schema
        .createIndex("tool_credentials_one_org")
        .on("tool_credentials")
        .column("tool")
        .unique()
        .where(sql.ref("scope"), "=", "org")
        .execute()
      await db.schema
        .createIndex("tool_credentials_one_per_user")
        .on("tool_credentials")
        .columns(["tool", "scope", "tenant_id"])
        .unique()
        .where(sql.ref("tenant_id"), "is not", null)
        .execute()
    },
  },

  "007-attention": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("approvals")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("job_id", "integer")
        .addColumn("session", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("tool", "text", (column) => column.notNull())
        .addColumn("arguments_hash", "text", (column) => column.notNull())
        .addColumn("summary", "text", (column) => column.notNull())
        .addColumn("state", "text", (column) => column.notNull())
        .addColumn("reason", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("answered_at", "text")
        .execute()

      // The gate's lookup: an approved, unconsumed approval for this exact call.
      await db.schema
        .createIndex("approvals_match")
        .on("approvals")
        .columns(["session", "tool", "arguments_hash", "state"])
        .execute()

      await db.schema
        .createTable("attention")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("kind", "text", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("detail", "text")
        .addColumn("status", "text", (column) => column.notNull())
        .addColumn("session", "text", (column) => column.notNull())
        .addColumn("job_id", "integer")
        .addColumn("approval_id", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("resolved_at", "text")
        .execute()

      await db.schema
        .createIndex("attention_open")
        .on("attention")
        .columns(["tenant_id", "status"])
        .execute()
    },
  },

  "008-search": {
    async up(db: Kysely<never>) {
      // FTS5 over the text an agent can read. kind/ref_id/tenant_id are stored
      // but UNINDEXED — they filter and identify, they are not searched; title
      // and body are the searchable columns. bm25() ranks; tenant_id scopes.
      await sql`
        CREATE VIRTUAL TABLE search_index USING fts5(
          kind UNINDEXED,
          ref_id UNINDEXED,
          tenant_id UNINDEXED,
          title,
          body,
          tokenize = 'porter unicode61'
        )
      `.execute(db)
    },
  },

  "009-memory": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("memory")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("tier", "text", (column) => column.notNull())
        .addColumn("key", "text")
        .addColumn("body", "text", (column) => column.notNull())
        .addColumn("pinned", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("derived_from", "text", (column) => column.notNull().defaultTo("[]"))
        .addColumn("source", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      // An agent's notes, and its digested notes by name (for replace-by-name).
      await db.schema
        .createIndex("memory_agent")
        .on("memory")
        .columns(["tenant_id", "agent", "tier"])
        .execute()
      // A digested note is unique by (agent, key) so re-digesting replaces it.
      await db.schema
        .createIndex("memory_digested_key")
        .on("memory")
        .columns(["tenant_id", "agent", "key"])
        .unique()
        .where(sql.ref("key"), "is not", null)
        .execute()
    },
  },

  "010-skills": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("skills")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("scope", "text", (column) => column.notNull())
        .addColumn("tenant_id", "text")
        .addColumn("agent", "text")
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("description", "text", (column) => column.notNull())
        .addColumn("instructions", "text", (column) => column.notNull())
        .addColumn("allowed_tools", "text")
        .addColumn("source", "text", (column) => column.notNull())
        .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      // What the render reads: an agent's own skills, plus the org directory.
      await db.schema
        .createIndex("skills_agent")
        .on("skills")
        .columns(["tenant_id", "agent"])
        .execute()
      // A name is unique within an agent, and within the org directory.
      await db.schema
        .createIndex("skills_agent_name")
        .on("skills")
        .columns(["tenant_id", "agent", "name"])
        .unique()
        .where(sql.ref("scope"), "=", "agent")
        .execute()
      await db.schema
        .createIndex("skills_org_name")
        .on("skills")
        .column("name")
        .unique()
        .where(sql.ref("scope"), "=", "org")
        .execute()
    },
  },

  "011-agent-memory": {
    async up(db: Kysely<never>) {
      // Legacy raw/digested/pinned memory was prompt state. It is deliberately
      // retired rather than migrated: this archive has different ownership and
      // retrieval semantics, and the old database only contains test data.
      await sql`DELETE FROM search_index WHERE kind = 'memory'`.execute(db)
      await db.schema.dropTable("memory").execute()

      await db.schema
        .createTable("agent_memory")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("key", "text")
        .addColumn("kind", "text", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("body", "text", (column) => column.notNull())
        .addColumn("contexts", "text", (column) => column.notNull().defaultTo("[]"))
        .addColumn("status", "text", (column) => column.notNull())
        .addColumn("version", "integer", (column) => column.notNull())
        .addColumn("supersedes", "text")
        .addColumn("source", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
      await db.schema
        .createIndex("agent_memory_owner")
        .on("agent_memory")
        .columns(["tenant_id", "agent", "status"])
        .execute()
      await db.schema
        .createIndex("agent_memory_active_key")
        .on("agent_memory")
        .columns(["tenant_id", "agent", "key"])
        .unique()
        .where(sql.ref("status"), "=", "active")
        .where(sql.ref("key"), "is not", null)
        .execute()
      await sql`
        CREATE VIRTUAL TABLE agent_memory_search USING fts5(
          ref_id UNINDEXED,
          tenant_id UNINDEXED,
          agent UNINDEXED,
          title,
          body,
          tokenize = 'porter unicode61'
        )
      `.execute(db)
    },
  },

  "012-mcp-servers": {
    async up(db: Kysely<never>) {
      // Org-wide MCP registrations. Access rides the named integration's
      // per-user token; this table only holds where the server is and which of
      // its tools an admin enabled. No tenant column — it is shared config.
      await db.schema
        .createTable("mcp_servers")
        .addColumn("name", "text", (column) => column.primaryKey())
        .addColumn("url", "text", (column) => column.notNull())
        .addColumn("transport", "text", (column) => column.notNull())
        .addColumn("integration", "text", (column) => column.notNull())
        .addColumn("tools", "text", (column) => column.notNull().defaultTo("[]"))
        .addColumn("tool_descriptions", "text", (column) => column.notNull().defaultTo("{}"))
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
    },
  },

  "013-chats": {
    async up(db: Kysely<never>) {
      // Multiple conversations per agent. `session` (the Flue conversation id) is
      // stored and UNIQUE; the first main chat keeps the bare `tenant:agent`, so
      // existing conversations are adopted in place on first access.
      await db.schema
        .createTable("chats")
        .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("session", "text", (column) => column.notNull().unique())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("kind", "text", (column) => column.notNull())
        .addColumn("closed_at", "text")
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("last_message_at", "text")
        .execute()
      await db.schema
        .createIndex("chats_owner")
        .on("chats")
        .columns(["tenant_id", "agent"])
        .execute()

      // Unread replies per chat, keyed by session (the only thing the audit tap
      // sees); agent carried alongside so the roster badge is a SUM, not a join.
      await db.schema
        .createTable("chat_unread")
        .addColumn("session", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent", "text", (column) => column.notNull())
        .addColumn("count", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
      await db.schema
        .createIndex("chat_unread_owner")
        .on("chat_unread")
        .columns(["tenant_id", "agent"])
        .execute()
    },
  },

  "014-toolset-label": {
    async up(db: Kysely<never>) {
      // MCP toolsets gain a friendly label (e.g. "Gmail read-only"), distinct
      // from the slug used as the grant key. Existing rows default to the name.
      await db.schema.alterTable("mcp_servers").addColumn("label", "text").execute()
      await sql`UPDATE mcp_servers SET label = name WHERE label IS NULL`.execute(db)
    },
  },

  "015-rename-mcp-servers-to-toolsets": {
    async up(db: Kysely<never>) {
      // The record is a "toolset" everywhere in the UI and the code now; rename
      // the table to match. Same columns — only the name changes.
      await db.schema.alterTable("mcp_servers").renameTo("toolsets").execute()
    },
  },

  "016-integrations": {
    async up(db: Kysely<never>) {
      // Integration *instances*: an admin can register several apps of a type
      // (two Slack apps with different scopes, say). The client id/secret stay
      // in tool_credentials keyed by the slug; this table holds the metadata.
      await db.schema
        .createTable("integrations")
        .addColumn("name", "text", (column) => column.primaryKey())
        .addColumn("label", "text", (column) => column.notNull())
        .addColumn("type", "text", (column) => column.notNull())
        .addColumn("scopes", "text", (column) => column.notNull().defaultTo("[]"))
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      // Seed the two default instances (matching the prior fixed integrations),
      // so any app config or connection already keyed by "google"/"slack" keeps
      // working. Scopes mirror the code defaults; an admin can edit them.
      const now = new Date().toISOString()
      const google = JSON.stringify([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ])
      const slack = JSON.stringify([
        "channels:read",
        "channels:history",
        "groups:read",
        "groups:history",
        "im:read",
        "im:history",
        "users:read",
        "search:read",
      ])
      await db
        .insertInto("integrations" as never)
        .values([
          {
            name: "google",
            label: "Google Workspace",
            type: "google",
            scopes: google,
            created_at: now,
            updated_at: now,
          },
          {
            name: "slack",
            label: "Slack",
            type: "slack",
            scopes: slack,
            created_at: now,
            updated_at: now,
          },
        ] as never)
        .execute()
    },
  },

  "017-teams": {
    async up(db: Kysely<never>) {
      // Teams — a tool-grant authorization layer (not data isolation). Org-wide,
      // so no tenant column: members are user ids, grants are toolset keys.
      await db.schema
        .createTable("teams")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      await db.schema
        .createTable("team_members")
        .addColumn("team_id", "text", (column) => column.notNull())
        .addColumn("user_id", "text", (column) => column.notNull())
        .addPrimaryKeyConstraint("team_members_pk", ["team_id", "user_id"])
        .execute()
      await db.schema
        .createIndex("team_members_user")
        .on("team_members")
        .column("user_id")
        .execute()

      await db.schema
        .createTable("team_grants")
        .addColumn("team_id", "text", (column) => column.notNull())
        .addColumn("toolset", "text", (column) => column.notNull())
        .addPrimaryKeyConstraint("team_grants_pk", ["team_id", "toolset"])
        .execute()
    },
  },

  "018-integration-repos": {
    async up(db: Kysely<never>) {
      // Docker Sandbox integrations mount repos; other kinds ignore this column.
      await db.schema
        .alterTable("integrations")
        .addColumn("repos", "text", (column) => column.notNull().defaultTo("[]"))
        .execute()
    },
  },

  "019-toolset-kind": {
    async up(db: Kysely<never>) {
      // A toolset is now `mcp` (a server + tool selection) or `sandbox` (a Docker
      // Sandbox integration). Existing rows are all MCP.
      await db.schema
        .alterTable("toolsets")
        .addColumn("kind", "text", (column) => column.notNull().defaultTo("mcp"))
        .execute()
    },
  },

  "020-team-integration-grants": {
    async up(db: Kysely<never>) {
      // Teams also grant integrations — a second gate over toolsets: a toolset
      // attaches only if its own key AND its underlying integration are granted.
      // The value is an integration name (matches the integrations table).
      await db.schema
        .createTable("team_integration_grants")
        .addColumn("team_id", "text", (column) => column.notNull())
        .addColumn("integration", "text", (column) => column.notNull())
        .addPrimaryKeyConstraint("team_integration_grants_pk", ["team_id", "integration"])
        .execute()
    },
  },

  "021-integration-mcp-url": {
    async up(db: Kysely<never>) {
      // A token integration (e.g. Firecrawl) can point at a custom MCP server —
      // self-hosted, say. Empty means "use the type's default MCP URL".
      await db.schema
        .alterTable("integrations")
        .addColumn("mcp_url", "text", (column) => column.notNull().defaultTo(""))
        .execute()
    },
  },

  "022-toolset-gated-tools": {
    async up(db: Kysely<never>) {
      // Which enabled MCP tools require operator approval per call — a subset of
      // `tools`, JSON-encoded. Empty means nothing in the toolset is gated.
      await db.schema
        .alterTable("toolsets")
        .addColumn("gated_tools", "text", (column) => column.notNull().defaultTo("[]"))
        .execute()
    },
  },

  "023-credential-base-url": {
    async up(db: Kysely<never>) {
      // A `local` credential (LM Studio, and the like) carries no secret, just
      // the endpoint it runs on. Empty for cloud credentials, which get their
      // base URL from the upstream.
      await db.schema
        .alterTable("model_credentials")
        .addColumn("base_url", "text", (column) => column.notNull().defaultTo(""))
        .execute()
    },
  },

  "024-file-labels": {
    async up(db: Kysely<never>) {
      // Files carry topics — inline JSON on the row, modelled on
      // `agent_memory.contexts`. A side table is a later add only if a label
      // query turns out slow; existing rows have none.
      await db.schema
        .alterTable("files")
        .addColumn("labels", "text", (column) => column.notNull().defaultTo("[]"))
        .execute()
    },
  },

  "025-operator-profile": {
    async up(db: Kysely<never>) {
      // Who each tenant's staff work for — one row per tenant, prepended to
      // every agent's system prompt. A tenant *is* the operator, so tenant_id is
      // the whole key; there is at most one profile per account.
      await db.schema
        .createTable("operator_profiles")
        .addColumn("tenant_id", "text", (column) => column.primaryKey())
        .addColumn("text", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
    },
  },

  "026-credential-default-model": {
    async up(db: Kysely<never>) {
      // The model an agent gets when it names none — stored on the default
      // credential, chosen by an admin, so the fallback is a real valid pair
      // (this credential, this model) rather than a hard-coded id that rots when
      // the upstream rolls its lineup forward. Null on non-default rows.
      await db.schema.alterTable("model_credentials").addColumn("default_model", "text").execute()
    },
  },

  "027-staff-description": {
    async up(db: Kysely<never>) {
      // This is intentionally separate from the private system prompt: peers
      // see it in `list_staff` to choose the right colleague for a task.
      await db.schema
        .alterTable("staff")
        .addColumn("description", "text", (column) => column.notNull().defaultTo(""))
        .execute()
    },
  },

  "028-report-mode": {
    async up(db: Kysely<never>) {
      // A finished job announces its summary in the originator's chat. A job can
      // instead stay silent unless its assignee closes with `report: true` — the
      // way a "watch for X" routine avoids pinging the main chat on quiet runs.
      // A job a person opened keeps announcing, so the default is `always`.
      await db.schema
        .alterTable("jobs")
        .addColumn("report_mode", "text", (column) => column.notNull().defaultTo("always"))
        .execute()
      // Routine-opened jobs are silent by default: a routine speaks up only when
      // it has something. A routine that should report every run sets `always`.
      await db.schema
        .alterTable("routines")
        .addColumn("report_mode", "text", (column) => column.notNull().defaultTo("on_request"))
        .execute()
    },
  },

  "029-device-tokens": {
    async up(db: Kysely<never>) {
      // Where a tenant's push notifications go. Keyed by the device token so a
      // re-register (the token rotates, the app reinstalls) replaces the row
      // rather than stacking. Tenant-scoped like everything else, so dispatch
      // fans out only to the account that owns the device.
      await db.schema
        .createTable("device_tokens")
        .addColumn("token", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("platform", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
      await db.schema
        .createIndex("device_tokens_tenant")
        .on("device_tokens")
        .column("tenant_id")
        .execute()
    },
  },

  "030-device-token-keys": {
    async up(db: Kysely<never>) {
      // Web Push subscriptions carry a key pair (`p256dh`, `auth`) the payload
      // is encrypted against; APNs tokens do not. One nullable JSON column holds
      // them rather than a side table — the registry is small and read whole per
      // dispatch. Empty for the APNs rows migration 029 already created.
      await db.schema
        .alterTable("device_tokens")
        .addColumn("keys", "text", (column) => column.notNull().defaultTo(""))
        .execute()
    },
  },

  "031-job-attempts": {
    async up(db: Kysely<never>) {
      // How many times recovery has re-driven a job after a transient turn
      // failure (a dropped model WebSocket, a 429). Bounded, and zeroed on a
      // clean turn — so it counts consecutive failures, not lifetime ones.
      // Existing rows start at 0: nothing has been recovered before this ran.
      await db.schema
        .alterTable("jobs")
        .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
        .execute()
    },
  },

  "032-tool-credential-stale": {
    async up(db: Kysely<never>) {
      // When a provider rejects a stored token as unauthorized (a 401), we mark
      // the row's `stale_at` so the integration reads as "needs reconnect"
      // rather than silently "connected". Nullable, unset for existing rows
      // (nothing has been rejected before this ran); cleared on the next
      // successful call or on reconnect.
      await db.schema.alterTable("tool_credentials").addColumn("stale_at", "text").execute()
    },
  },

  "033-widgets": {
    async up(db: Kysely<never>) {
      // A widget is one durable output an agent owns — Markdown or a Vega-Lite
      // chart — addressed by a stable `key`. Re-using the key updates the row in
      // place, so there is no history here: the widget is the latest snapshot,
      // and the agent's memory is the history behind it. Tenant-private, like
      // memory and jobs — no org sharing.
      await db.schema
        .createTable("widgets")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("agent_id", "text", (column) => column.notNull())
        .addColumn("key", "text", (column) => column.notNull())
        .addColumn("type", "text", (column) => column.notNull())
        .addColumn("title", "text", (column) => column.notNull())
        .addColumn("content", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()

      // The board read: an agent's widgets, one tenant's.
      await db.schema
        .createIndex("widgets_owner")
        .on("widgets")
        .columns(["tenant_id", "agent_id"])
        .execute()
      // The upsert target: a key is unique within an agent, so re-using it
      // updates in place rather than stacking a second widget.
      await db.schema
        .createIndex("widgets_key")
        .on("widgets")
        .columns(["tenant_id", "agent_id", "key"])
        .unique()
        .execute()
    },
  },

  "034-dashboards": {
    async up(db: Kysely<never>) {
      // A dashboard is a user-curated grid; tenant-private, like widgets.
      await db.schema
        .createTable("dashboards")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .addColumn("updated_at", "text", (column) => column.notNull())
        .execute()
      await db.schema
        .createIndex("dashboards_tenant")
        .on("dashboards")
        .column("tenant_id")
        .execute()

      // A placement references a live widget by id and carries its grid box.
      // Both foreign keys cascade on delete: removing a dashboard drops its
      // items, and removing a widget drops every placement of it — so a
      // dashboard never points at a widget that is gone. (foreign_keys is ON.)
      await db.schema
        .createTable("dashboard_items")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("dashboard_id", "text", (column) =>
          column.notNull().references("dashboards.id").onDelete("cascade"),
        )
        .addColumn("widget_id", "text", (column) =>
          column.notNull().references("widgets.id").onDelete("cascade"),
        )
        .addColumn("x", "integer", (column) => column.notNull())
        .addColumn("y", "integer", (column) => column.notNull())
        .addColumn("w", "integer", (column) => column.notNull())
        .addColumn("h", "integer", (column) => column.notNull())
        .addColumn("created_at", "text", (column) => column.notNull())
        .execute()
      await db.schema
        .createIndex("dashboard_items_dashboard")
        .on("dashboard_items")
        .column("dashboard_id")
        .execute()
      await db.schema
        .createIndex("dashboard_items_widget")
        .on("dashboard_items")
        .column("widget_id")
        .execute()
    },
  },

  "035-schedules": {
    async up(db: Kysely<never>) {
      // Routines become schedules: the same one row, but a schedule may now run
      // as a routine (recurring) or once. The `schedule` column held the *when*
      // (cron/interval) — that union is now `Timing`, so the column is renamed
      // to `timing` and gains a third `once` variant. `completed_at` records
      // when a one-off fired and was marked done; it then drops out of the
      // derived subscriptions so it never fires again. Existing rows carry over
      // untouched as active recurring schedules (completed_at null).
      await db.schema.alterTable("routines").renameTo("schedules").execute()
      await db.schema.alterTable("schedules").renameColumn("schedule", "timing").execute()
      await db.schema.alterTable("schedules").addColumn("completed_at", "text").execute()
      // The table rename leaves the index attached under its old name; rename it
      // to match by dropping and recreating.
      await db.schema.dropIndex("routines_tenant").execute()
      await db.schema.createIndex("schedules_tenant").on("schedules").column("tenant_id").execute()
    },
  },

  "036-chat-preview": {
    async up(db: Kysely<never>) {
      // A short plain-text excerpt of the agent's last reply in a chat, so the
      // inbox can show what was said without loading a transcript. Null until
      // an agent turn produces text; existing chats fill in on their next reply.
      await db.schema.alterTable("chats").addColumn("last_preview", "text").execute()
    },
  },
}

export interface MigrationOutcome {
  applied: string[]
}

/**
 * Bring the database up to date. Runs at boot, before anything reads, and is a
 * no-op when there is nothing to apply.
 *
 * Failing here fails the process on purpose: a server running against a schema
 * it could not finish migrating is the one situation where carrying on
 * cheerfully does the most damage.
 */
export async function migrateToLatest<S>(
  database: Database<S>,
  list: Record<string, Migration> = migrations,
): Promise<MigrationOutcome> {
  const migrator = new Migrator({
    db: database.qb as unknown as Kysely<never>,
    provider: { getMigrations: async () => list },
  })
  const { error, results } = await migrator.migrateToLatest()
  if (error) {
    const failed = results?.find((result) => result.status === "Error")
    throw new Error(
      `[staffroom] migration ${failed?.migrationName ?? "(unknown)"} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  return { applied: (results ?? []).map((result) => result.migrationName) }
}
