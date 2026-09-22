import { type ReactNode, useState } from "react"
import {
  Button,
  type ButtonProps,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../design/index.ts"

/**
 * A yes/no dialog on the design system — the shared shape behind "delete this?"
 * and "name this attachment". It owns the pending state around {@link onConfirm}:
 * the confirm button disables and shows {@link pendingLabel} while the action
 * runs, and the dialog closes once it settles. Mount it only while open, e.g.
 * `{target && <ConfirmDialog open onOpenChange={…} … />}`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  confirmDisabled = false,
  pendingLabel,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger for a destructive confirm; primary otherwise. */
  confirmVariant?: ButtonProps["variant"]
  /** Hold the confirm button disabled — e.g. a required field is still empty. */
  confirmDisabled?: boolean
  /** Shown on the confirm button while the action runs; falls back to the label. */
  pendingLabel?: string
  onConfirm: () => void | Promise<void>
  /** Extra content between the description and the buttons, e.g. an input. */
  children?: ReactNode
}) {
  const [pending, setPending] = useState(false)

  async function confirm() {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onOpenChange(false)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && <DialogDescription>{description}</DialogDescription>}
        {children && <div className="px-4 pt-3.5">{children}</div>}
        <DialogFooter>
          <Button disabled={pending} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            disabled={pending || confirmDisabled}
            onClick={() => void confirm()}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
