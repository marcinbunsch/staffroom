# ThreadTabs

The chat strip under an agent's thread header: the persistent thread plus any
open chats, a `+` to start one, and `History` to reopen a closed one.

```jsx
<ThreadTabs
  activeId="t1"
  historyCount={4}
  tabs={[
    { id: "t1", label: "Main", status: "idle", closable: false },
    { id: "t2", label: "New chat", status: "open" },
    { id: "t3", label: "copy/onboarding", status: "idle" },
  ]}
  onHistory={() => setHistoryOpen(true)}
/>
```

## Structure

```
bar:      flex items-center gap-1.5 border-t border-line-default
          bg-surface-panel px-3 py-2
strip:    flex min-w-0 flex-1 items-center gap-1 overflow-x-auto
tab:      group/tab relative · rounded-control border py-[7px]
  active:   border-line-strong bg-surface-selected text-ink-primary
  rest:     border-transparent bg-transparent text-ink-muted
            hover:bg-surface-hover hover:text-ink-secondary
  padding:  pr-[26px] pl-[11px] when closable (reserves the ×), else px-[11px]
  dot:      6px · open → bg-status-working animate-pulse-dot · else bg-status-idle
  label:    max-w-[180px] truncate
  close:    absolute right-[5px] h-[18px] w-[18px] rounded-chip · opacity-0
            pointer-events-none · group-hover/tab:opacity-100
            group-hover/tab:pointer-events-auto · focus-visible:opacity-100
            focus:pointer-events-auto · hover:bg-surface-control
new:      h-8 w-8 rounded-control ghost icon button (ti-plus)
history:  ghost text button (ti-history) + mono count in text-ink-label
```

## Rules

- **Only the active tab is filled.** Eight quiet labels plus one pill reads as
  one place you are; eight pills read as eight buttons.
- **Reserve the close button's space.** `pr-[26px]` on closable tabs means the
  `×` appearing on hover never reflows the label.
- **Reveal is hover _and_ focus, and `pointer-events-none` at rest** — otherwise
  the invisible `×` swallows clicks meant for the tab, and touch users can never
  reach it.
- **"Main" is `closable: false`.** It's the durable thread; it can't be closed,
  and it never appears in `ChatHistory`.
- **The count belongs here, not in the dialog.** `historyCount` tells you
  whether opening History is worth it; a count inside the dialog only repeats
  rows already on screen.
- **Status is the only colour.** A live chat's dot pulses; everything else is
  `bg-status-idle`.

## Pairs with

`ChatHistory` — `onHistory` opens it, and it has no create action of its own
because the `+` here owns that.

## Reference implementation

```jsx
import React from "react"

/* ThreadTabs — the chat strip under an agent's thread header.
   Only the active tab is filled; the rest are quiet text until hovered, so a
   row of eight tabs doesn't read as eight buttons. Each tab carries a status
   dot (working pulse for a live chat, idle grey otherwise). Closable tabs keep
   reserved space for the × so labels never reflow when it appears, and the ×
   is pointer-events-none until revealed. "Main" is not closable.
   The + creates a chat; History opens <ChatHistory /> and carries the count. */

function Dot({ status }) {
  if (status === "open") {
    return (
      <span className="relative grid h-[6px] w-[6px] shrink-0 place-items-center">
        <span className="absolute h-[6px] w-[6px] rounded-full bg-status-working animate-pulse-dot" />
      </span>
    )
  }
  return <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-status-idle" />
}

function Tab({ tab, active, onSelect, onClose }) {
  const closable = tab.closable !== false
  return (
    <div className="group/tab relative flex shrink-0 items-center">
      <button
        type="button"
        aria-current={active ? "page" : "false"}
        onClick={() => onSelect?.(tab)}
        className={
          "flex cursor-pointer items-center gap-2 rounded-control border py-[7px] font-sans text-secondary transition-[background-color,color,border-color] duration-[120ms] ease-out " +
          (active
            ? "border-line-strong bg-surface-selected text-ink-primary "
            : "border-transparent bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-secondary ") +
          (closable ? "pr-[26px] pl-[11px]" : "px-[11px]")
        }
      >
        <Dot status={tab.status} />
        <span className="max-w-[180px] truncate">{tab.label}</span>
      </button>
      {closable && (
        <button
          type="button"
          aria-label={`Close ${tab.label}`}
          title="Close tab"
          onClick={() => onClose?.(tab)}
          className="pointer-events-none absolute right-[5px] grid h-[18px] w-[18px] place-items-center rounded-chip border-0 bg-transparent p-0 text-ink-faint opacity-0 transition-[background-color,color,opacity] duration-[120ms] ease-out group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 hover:bg-surface-control hover:text-ink-primary focus:pointer-events-auto focus-visible:opacity-100"
        >
          <i className="ti ti-x text-[12px]" />
        </button>
      )}
    </div>
  )
}

export function ThreadTabs({
  tabs = [],
  activeId,
  historyCount,
  onSelect,
  onClose,
  onNew,
  onHistory,
}) {
  return (
    <div className="flex items-center gap-1.5 border-t border-line-default bg-surface-panel px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Tab
            key={t.id}
            tab={t}
            active={t.id === activeId}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={onNew}
          className="ml-0.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
        >
          <i className="ti ti-plus text-[16px]" />
        </button>
      </div>
      <button
        type="button"
        onClick={onHistory}
        className="flex shrink-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-[11px] py-[7px] font-sans text-secondary text-ink-muted transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
      >
        <i className="ti ti-history text-[15px]" />
        <span>History</span>
        {historyCount != null && (
          <span className="font-mono text-mono text-ink-label">{historyCount}</span>
        )}
      </button>
    </div>
  )
}
```
