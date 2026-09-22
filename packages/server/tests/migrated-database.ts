import { Database, openConnection } from "../src/coordinator/database.ts"
import { migrateToLatest } from "../src/coordinator/migrations.ts"

/**
 * A fresh in-memory database with every migration applied.
 *
 * Stores no longer create their own tables, which is the point of having
 * migrations at all — but it means a store test has to be handed a migrated
 * database. That is a feature: every store test now exercises the real
 * migrations, so a column added to a store and forgotten in a migration fails
 * immediately rather than at deploy.
 */
export async function migratedDatabase(): Promise<Database> {
  const database = new Database(openConnection(":memory:"))
  await migrateToLatest(database)
  return database
}
