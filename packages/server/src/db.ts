import { join } from "node:path"
import { sqlite } from "@flue/runtime/node"
import { STAFFROOM_HOME } from "./core/config.ts"

// Flue's own durable store: conversations, submissions, attachments. Kept
// separate from staffroom.db so operational data and Flue's truth can be
// backed up, inspected and (for Flue) upgraded independently. sqlite() creates
// STAFFROOM_HOME and the file (WAL mode) on first boot.
//
// Without this file the built server is in-memory and loses every conversation
// on restart — which is the one thing the walking skeleton has to prove it
// does not do.
export default sqlite(join(STAFFROOM_HOME, "flue.db"))
