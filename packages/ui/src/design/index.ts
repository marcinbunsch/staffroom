/**
 * The Staff design system, ported from the prototype's `design/` to typed TSX.
 * Presentational only — domain state maps to these status words in the callers,
 * never inline. This v2 subset carries the primitives the ported screens need;
 * more land as their screens do.
 */

export { Avatar, type AvatarProps } from "./core/Avatar.tsx"
export { Button, type ButtonProps } from "./core/Button.tsx"
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogSize,
} from "./core/Dialog.tsx"
export { KindChip, type KindChipProps } from "./core/KindChip.tsx"
export { Pager, type PagerProps } from "./core/Pager.tsx"
export { PrivacyBadge, type PrivacyBadgeProps } from "./core/PrivacyBadge.tsx"
export { ProgressBar, type ProgressBarProps } from "./core/ProgressBar.tsx"
export { SectionHeader, type SectionHeaderProps } from "./core/SectionHeader.tsx"
export { StatusDot, type StatusDotProps, type Status } from "./core/StatusDot.tsx"
export { ToolChip, type ToolChipProps } from "./core/ToolChip.tsx"
export { UnreadBadge, type UnreadBadgeProps } from "./core/UnreadBadge.tsx"
export { AgentWorkCard, type AgentWorkCardProps } from "./patterns/AgentWorkCard.tsx"
export { ArtifactRow, type ArtifactRowProps } from "./patterns/ArtifactRow.tsx"
export { AttentionRow, type AttentionRowProps } from "./patterns/AttentionRow.tsx"
export { Composer as DesignComposer, type ComposerProps } from "./patterns/Composer.tsx"
export { DropZone, type DropZoneProps } from "./patterns/DropZone.tsx"
export { MemoryNote, type MemoryNoteProps } from "./patterns/MemoryNote.tsx"
export { Message, type MessageProps } from "./patterns/Message.tsx"
export { ProposalRow, type ProposalRowProps } from "./patterns/ProposalRow.tsx"
export { RosterRow, type RosterRowProps } from "./patterns/RosterRow.tsx"
export {
  Timeline,
  TimelineEntry,
  type TimelineProps,
  type TimelineEntryProps,
} from "./patterns/TimelineEntry.tsx"
