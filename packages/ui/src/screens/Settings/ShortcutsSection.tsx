import { observer } from "mobx-react-lite"
import { type ReactNode, useEffect, useState } from "react"
import { Button } from "../../design/index.ts"
import {
  bindingFromEvent,
  formatBinding,
  isModifierCode,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from "../../lib/shortcuts.ts"
import { useStores } from "../../stores/context.tsx"

/**
 * Rebind the navigation shortcuts. Each row shows its current chord and a Change
 * button; while recording, the next real chord (a non-modifier key plus whatever
 * modifiers are held) is captured and saved. Esc cancels. The capture listener
 * runs in the capture phase and stops propagation, so the chord never reaches the
 * app's own global handler while you're recording it.
 */
export const ShortcutsSection = observer(function ShortcutsSection() {
  const store = useStores()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)

  useEffect(() => {
    if (!recording) return
    const action = recording
    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === "Escape") {
        setRecording(null)
        return
      }
      // Wait for the actual key; a bare ⌘/⇧ press isn't a binding on its own.
      if (isModifierCode(event.code)) return
      store.shortcuts.setBinding(action, bindingFromEvent(event))
      setRecording(null)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [recording, store])

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Shortcuts</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        Keyboard shortcuts for moving around Staffroom. Click Change and press the new combination;
        Esc cancels.
      </p>
      <div className="mt-6 flex flex-col gap-0.5">
        {SHORTCUT_ACTIONS.map((entry, index) => (
          <Row
            key={entry.id}
            title={entry.label}
            description={entry.description}
            last={index === SHORTCUT_ACTIONS.length - 1}
          >
            <kbd className="min-w-[52px] rounded-control border border-line-strong bg-surface-selected px-2 py-1 text-center font-mono text-mono text-ink-body">
              {formatBinding(store.shortcuts.bindings[entry.id])}
            </kbd>
            <Button
              variant={recording === entry.id ? "primary" : "secondary"}
              onClick={() => setRecording(recording === entry.id ? null : entry.id)}
            >
              {recording === entry.id ? "Press keys…" : "Change"}
            </Button>
          </Row>
        ))}
      </div>
      <div className="mt-6 px-1">
        <Button variant="ghost" onClick={() => store.shortcuts.reset()}>
          Reset to defaults
        </Button>
      </div>
    </section>
  )
})

function Row({
  title,
  description,
  children,
  last = false,
}: {
  title: string
  description: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-1 py-4 ${
        last ? "" : "border-b border-line-subtle"
      }`}
    >
      <div className="min-w-0 flex-[1_1_300px]">
        <div className="text-secondary font-medium text-ink-body">{title}</div>
        <div className="mt-1 text-meta text-ink-faint">{description}</div>
      </div>
      {children}
    </div>
  )
}
