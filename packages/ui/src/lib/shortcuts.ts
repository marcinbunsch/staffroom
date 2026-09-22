/**
 * Configurable keyboard shortcuts for moving around the app: the command palette
 * (⌘K), next/previous agent in the roster, and next/previous chat within the
 * open agent.
 *
 * A binding is a *physical* key (`event.code`, so Shift changing the printed
 * character — `[` → `{` — doesn't break the match) plus the modifier set. The
 * whole map is persisted to localStorage under one key, so a rebind survives a
 * reload; when storage is unavailable the defaults just apply per-session.
 */

export type ShortcutAction =
  | "open-palette"
  | "next-agent"
  | "prev-agent"
  | "next-chat"
  | "prev-chat"
  | "close-chat"
  | "open-settings"

export type Binding = {
  /** `KeyboardEvent.code` — the physical key, independent of layout and Shift. */
  code: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; description: string }[] = [
  {
    id: "open-palette",
    label: "Command palette",
    description: "Open the palette to jump to an agent, job, chat or file, or run a command.",
  },
  { id: "next-agent", label: "Next agent", description: "Open the next agent in the roster." },
  {
    id: "prev-agent",
    label: "Previous agent",
    description: "Open the previous agent in the roster.",
  },
  {
    id: "next-chat",
    label: "Next chat",
    description: "Switch to the next chat of the open agent.",
  },
  {
    id: "prev-chat",
    label: "Previous chat",
    description: "Switch to the previous chat of the open agent.",
  },
  {
    id: "close-chat",
    label: "Close chat",
    description: "Close the open side chat. The main chat can't be closed.",
  },
  { id: "open-settings", label: "Open settings", description: "Open the settings screen." },
]

/**
 * cmd-k for the command palette, cmd-[ / cmd-] for agents, shift-cmd-[ /
 * shift-cmd-] for chats, cmd-w to close the open side chat, and cmd-, for
 * settings — the conventional macOS chords.
 */
export const DEFAULT_BINDINGS: Record<ShortcutAction, Binding> = {
  "open-palette": { code: "KeyK", meta: true, ctrl: false, alt: false, shift: false },
  "next-agent": { code: "BracketLeft", meta: true, ctrl: false, alt: false, shift: false },
  "prev-agent": { code: "BracketRight", meta: true, ctrl: false, alt: false, shift: false },
  "next-chat": { code: "BracketLeft", meta: true, ctrl: false, alt: false, shift: true },
  "prev-chat": { code: "BracketRight", meta: true, ctrl: false, alt: false, shift: true },
  "close-chat": { code: "KeyW", meta: true, ctrl: false, alt: false, shift: false },
  "open-settings": { code: "Comma", meta: true, ctrl: false, alt: false, shift: false },
}

const STORAGE_KEY = "staffroom-shortcuts"

/** The saved bindings merged over the defaults, so a new action is always present. */
export function loadBindings(): Record<ShortcutAction, Binding> {
  const bindings: Record<ShortcutAction, Binding> = { ...DEFAULT_BINDINGS }
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return bindings
    const saved = JSON.parse(raw) as Partial<Record<ShortcutAction, Partial<Binding>>>
    for (const action of Object.keys(bindings) as ShortcutAction[]) {
      const b = saved[action]
      if (b && typeof b.code === "string") {
        bindings[action] = {
          code: b.code,
          meta: !!b.meta,
          ctrl: !!b.ctrl,
          alt: !!b.alt,
          shift: !!b.shift,
        }
      }
    }
  } catch {
    // Corrupt JSON or unavailable storage: fall back to the defaults.
  }
  return bindings
}

export function saveBindings(bindings: Record<ShortcutAction, Binding>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // Private mode / over quota: the rebind just won't persist.
  }
}

/** The chord a keyboard event represents, so a settings pane can record one. */
export function bindingFromEvent(event: KeyboardEvent): Binding {
  return {
    code: event.code,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  }
}

export function bindingMatches(binding: Binding, event: KeyboardEvent): boolean {
  return (
    binding.code === event.code &&
    binding.meta === event.metaKey &&
    binding.ctrl === event.ctrlKey &&
    binding.alt === event.altKey &&
    binding.shift === event.shiftKey
  )
}

/** Which action, if any, a key event triggers under the current bindings. */
export function matchAction(
  bindings: Record<ShortcutAction, Binding>,
  event: KeyboardEvent,
): ShortcutAction | undefined {
  for (const action of Object.keys(bindings) as ShortcutAction[]) {
    if (bindingMatches(bindings[action], event)) return action
  }
  return undefined
}

/** Whether a `code` is a bare modifier key — recording should wait for a real key. */
export function isModifierCode(code: string): boolean {
  return (
    code === "MetaLeft" ||
    code === "MetaRight" ||
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight"
  )
}

const CODE_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
}

function labelForCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  return code
}

/** A human chord like `⇧⌘[`, in the conventional macOS modifier order. */
export function formatBinding(binding: Binding): string {
  let out = ""
  if (binding.ctrl) out += "⌃"
  if (binding.alt) out += "⌥"
  if (binding.shift) out += "⇧"
  if (binding.meta) out += "⌘"
  return out + labelForCode(binding.code)
}
