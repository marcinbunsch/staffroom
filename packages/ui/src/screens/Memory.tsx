import { useCallback, useEffect, useState } from "react"
import { Summary } from "../components/Summary.tsx"
import { Button, SectionHeader } from "../design/index.ts"
import { type AgentMemoryEntryRow, type StaffRow, api } from "../lib/api.ts"
import { timeAgo } from "../lib/format.ts"

/** An operator view of each agent's external archive. Entries never enter prompts. */
export function Memory({ roster }: { roster: StaffRow[] }) {
  const [agent, setAgent] = useState<string>()
  const selected = agent ?? roster[0]?.id
  const [entries, setEntries] = useState<AgentMemoryEntryRow[]>([])
  const [error, setError] = useState<string>()
  const reload = useCallback(() => {
    if (selected) api.memory.list(selected).then(setEntries, () => setEntries([]))
  }, [selected])
  useEffect(() => reload(), [reload])

  if (!selected) return <div className="p-6 text-secondary text-ink-muted">No staff yet.</div>
  const selectedAgent = selected
  async function forget(id: string) {
    setError(undefined)
    try {
      await api.memory.forget(selectedAgent, id)
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.")
    }
  }

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Memory</h1>
            <p className="mt-1 text-secondary text-ink-muted">
              External knowledge archive · retrieved when needed, never added to the prompt.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roster.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setAgent(member.id)}
                className={`rounded-control border-0 px-3 py-1.5 text-secondary ${
                  member.id === selected
                    ? "bg-surface-selected text-ink-primary"
                    : "bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                {member.name}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-secondary text-status-failed">{error}</div>}
        <section>
          <SectionHeader tone="neutral" meta={`${entries.length}`}>
            Archive
          </SectionHeader>
          {entries.length === 0 ? (
            <div className="mt-4 text-secondary text-ink-muted">Nothing stored yet.</div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-[11px] border border-line-inset bg-surface-panel px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="font-mono text-mono text-status-working-dim">
                      {entry.kind}
                    </span>
                    <span className="font-medium text-secondary">{entry.title}</span>
                    <span className="text-meta text-ink-faint">
                      v{entry.version} · {timeAgo(entry.updatedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void forget(entry.id)}
                    >
                      Forget
                    </Button>
                  </div>
                  {entry.key && (
                    <div className="mt-1 font-mono text-meta text-ink-faint">{entry.key}</div>
                  )}
                  <div className="mt-1.5 text-meta text-ink-muted">
                    <Summary text={entry.body} />
                  </div>
                  {entry.contexts.length > 0 && (
                    <div className="mt-2 text-meta text-ink-faint">
                      {entry.contexts.join(" · ")}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
