import * as DialogPrimitive from "@radix-ui/react-dialog"
import type { ComponentProps, ReactNode, Ref } from "react"

/*
 * The one modal in the system, shadcn's Dialog composition on Radix, styled
 * with our tokens.
 *
 * Radix is here for the parts a hand-rolled overlay always gets wrong: focus
 * moves into the dialog and is trapped there, Escape closes it, the page behind
 * stops scrolling, the rest of the app is hidden from screen readers, and focus
 * returns to whatever opened it. None of that is worth writing twice.
 *
 * Composition, so a dialog reads as its own markup rather than a pile of props:
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Start a fresh thread?</DialogTitle>
 *         <DialogDescription>This one moves to the history.</DialogDescription>
 *       </DialogHeader>
 *       …
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * A title is required — by Radix, and by anyone using a screen reader. Where the
 * design has no visible heading, keep the title and pass `srOnly`.
 */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/** A confirmation, a list, a document, a big reader, and a fill-the-viewport pane. */
export type DialogSize = "sm" | "md" | "lg" | "xl" | "full"

// Explicit width and height caps, not Tailwind's stock scale — this product's
// measures are its own. Most dialogs share one height cap; `xl` is the roomy
// reader (a file's content) and `full` is the near-edge-to-edge pane (a chart
// you want to inspect closely), so those take nearly the whole viewport.
const CAP = "max-h-[min(620px,calc(100vh-96px))]"
const SIZES: Record<DialogSize, string> = {
  sm: `max-w-[420px] ${CAP}`,
  md: `max-w-[520px] ${CAP}`,
  lg: `max-w-[820px] ${CAP}`,
  xl: "max-w-[1080px] max-h-[calc(100vh-56px)]",
  full: "max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)]",
}

export function DialogContent({
  children,
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { size?: DialogSize }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 motion-safe:transition-opacity motion-safe:duration-150" />
      {/* Depth is a surface step and a 1px border over a dimmed backdrop —
          there are no drop shadows in this system. */}
      <DialogPrimitive.Content
        className={`fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-line-strong bg-surface-card outline-none ${SIZES[size]} ${className}`}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3.5">
      {children}
    </div>
  )
}

export function DialogTitle({
  children,
  srOnly = false,
  className = "",
}: {
  children: ReactNode
  /** Keeps the title for assistive tech where the design shows none. */
  srOnly?: boolean
  className?: string
}) {
  return (
    <DialogPrimitive.Title
      className={
        srOnly
          ? "sr-only"
          : `min-w-0 flex-1 text-secondary font-medium text-ink-primary ${className}`
      }
    >
      {children}
    </DialogPrimitive.Title>
  )
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Description className="px-4 pt-3.5 text-meta text-ink-muted text-pretty">
      {children}
    </DialogPrimitive.Description>
  )
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 px-4 pt-4 pb-4">{children}</div>
}

/**
 * The body between header and footer. It is the only part that scrolls — the
 * panel itself is clipped, so the header and footer stay put and the rounded
 * corners hold.
 */
export function DialogBody({
  ref,
  children,
  className = "px-4 py-3.5",
}: {
  ref?: Ref<HTMLDivElement>
  children: ReactNode
  className?: string
}) {
  return (
    <div ref={ref} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}>
      {children}
    </div>
  )
}
