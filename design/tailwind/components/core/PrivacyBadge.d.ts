import * as React from "react"

/**
 * @startingPoint section="Privacy" subtitle="Staff PrivacyBadge" viewport="700x220"
 */
export interface PrivacyBadgeProps {
  /** CONFIDENTIAL · SEALED · PRIVATE THREAD · ENC. */
  children?: React.ReactNode
  /** Leading teal dot, used on queue items. */
  dot?: boolean
}
