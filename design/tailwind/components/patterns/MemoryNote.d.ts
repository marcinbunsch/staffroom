import * as React from "react"

/**
 * @startingPoint section="Privacy" subtitle="Staff MemoryNote" viewport="700x220"
 */
export interface MemoryNoteProps {
  /** Mono memory key, e.g. "1-1-cadence". */
  noteKey: string
  body?: React.ReactNode
  /** Sealed notes mask their body and carry a SEALED badge. */
  sealed?: boolean
}
