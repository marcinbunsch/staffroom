import { useCallback, useEffect, useState } from "react"
import { Markdown } from "../components/Markdown.tsx"
import { Button, KindChip } from "../design/index.ts"
import { type Me, type NewSkill, type SkillRow, type StaffRow, api } from "../lib/api.ts"

type Mode = "agent" | "org"

/**
 * Skills: persistent, progressively-disclosed instructions an agent can mount.
 *
 * v2 keeps skills as rows (M10), so unlike the prototype's filesystem skills
 * they are visible and editable here — the visibility is what makes standing
 * instruction safe. An agent's list is its own agent-scoped skills plus the org
 * directory; the operator manages the agent-scoped ones, an admin curates the
 * org directory. Org skills are read-only here (edit/delete routes are a server
 * follow-up); `allowedTools` is admin-only and shown, never set from an agent.
 */
export function Skills({ me, roster }: { me: Me; roster: StaffRow[] }) {
  const [mode, setMode] = useState<Mode>("agent")
  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Skills</h1>
          <div className="ml-auto flex items-center overflow-hidden rounded-control border border-line-strong">
            <Tab label="Agents" active={mode === "agent"} onClick={() => setMode("agent")} />
            <Tab label="Org directory" active={mode === "org"} onClick={() => setMode("org")} />
          </div>
        </header>
        {mode === "agent" ? <AgentSkills roster={roster} /> : <OrgSkills me={me} />}
      </div>
    </div>
  )
}

function AgentSkills({ roster }: { roster: StaffRow[] }) {
  const [agent, setAgent] = useState<string>()
  const selected = agent ?? roster[0]?.id
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()

  const reload = useCallback(() => {
    if (!selected) return
    api.skills.list(selected).then(setSkills, () => setSkills([]))
  }, [selected])
  useEffect(() => reload(), [reload])

  if (!selected) return <div className="text-secondary text-ink-muted">No staff yet.</div>

  async function run(work: () => Promise<unknown>) {
    setError(undefined)
    try {
      await work()
      reload()
    } catch (caught) {
      setError(reason(caught))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
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
        <Button variant="secondary" className="ml-auto" onClick={() => setAdding(true)}>
          New skill
        </Button>
      </div>

      {error && <div className="text-secondary text-status-failed">{error}</div>}

      {adding && (
        <SkillForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await run(() => api.skills.create(selected, input))
            setAdding(false)
          }}
        />
      )}

      {skills.length === 0 && !adding ? (
        <div className="text-secondary text-ink-muted">
          No skills yet. Add one, or an agent can write itself one.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              editable={skill.scope === "agent"}
              onToggle={() =>
                run(() => api.skills.update(selected, skill.name, { enabled: !skill.enabled }))
              }
              onSave={(patch) => run(() => api.skills.update(selected, skill.name, patch))}
              onDelete={() => run(() => api.skills.remove(selected, skill.name))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OrgSkills({ me }: { me: Me }) {
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()
  const isAdmin = me.role === "admin"

  const reload = useCallback(() => {
    api.skills.org().then(setSkills, () => setSkills([]))
  }, [])
  useEffect(() => reload(), [reload])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center">
        <p className="text-secondary text-ink-meta">
          The house style — org skills every agent sees. {isAdmin ? "" : "Admin-managed."}
        </p>
        {isAdmin && (
          <Button variant="secondary" className="ml-auto" onClick={() => setAdding(true)}>
            New org skill
          </Button>
        )}
      </div>

      {error && <div className="text-secondary text-status-failed">{error}</div>}

      {adding && (
        <SkillForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            setError(undefined)
            try {
              await api.skills.createOrg(input)
              setAdding(false)
              reload()
            } catch (caught) {
              setError(reason(caught))
            }
          }}
        />
      )}

      {skills.length === 0 && !adding ? (
        <div className="text-secondary text-ink-muted">No org skills yet.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} editable={false} />
          ))}
        </div>
      )}
    </div>
  )
}

function SkillCard({
  skill,
  editable,
  onToggle,
  onSave,
  onDelete,
}: {
  skill: SkillRow
  editable: boolean
  onToggle?: () => void
  onSave?: (patch: { description: string; instructions: string }) => void
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(skill.description)
  const [instructions, setInstructions] = useState(skill.instructions)

  return (
    <div
      className={`rounded-card border bg-surface-card px-[18px] py-4 ${
        skill.enabled ? "border-line-default" : "border-line-inset opacity-70"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <i className={`ti ti-chevron-${open ? "down" : "right"} text-ink-faint`} />
          <span className="font-mono text-secondary font-semibold text-ink-primary">
            {skill.name}
          </span>
          <KindChip tone="neutral">
            {skill.scope === "org" ? "ORG" : skill.source.toUpperCase()}
          </KindChip>
          {!skill.enabled && <span className="text-meta text-ink-faint">disabled</span>}
        </button>
        {editable && (
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onToggle}>
              {skill.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDescription(skill.description)
                setInstructions(skill.instructions)
                setEditing(true)
                setOpen(true)
              }}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm(`Delete skill “${skill.name}”?`)) onDelete?.()
              }}
            >
              Delete
            </Button>
          </span>
        )}
      </div>

      <p className="mt-1.5 pl-6 text-secondary text-ink-muted">{skill.description}</p>

      {open && (
        <div className="mt-3 pl-6">
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                className={field}
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <textarea
                className={`${field} min-h-40 font-mono`}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
              <div className="flex gap-2 self-end">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onSave?.({ description: description.trim(), instructions: instructions.trim() })
                    setEditing(false)
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="markdown text-secondary [overflow-wrap:anywhere]">
              <Markdown>{skill.instructions}</Markdown>
              {skill.allowedTools && (
                <p className="mt-2 font-mono text-mono text-ink-faint">
                  pre-approved tools: {skill.allowedTools}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SkillForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: NewSkill) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")

  function create() {
    void onSubmit({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        create()
      }}
      className="flex flex-col gap-2 rounded-card border border-line-default bg-surface-card p-4"
    >
      <input
        className={field}
        placeholder="skill-name (lowercase, hyphens)"
        value={name}
        onChange={(event) => setName(event.target.value.toLowerCase())}
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        required
      />
      <input
        className={field}
        placeholder="One-line description (shown in the agent's prompt)"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        required
      />
      <textarea
        className={`${field} min-h-40 font-mono`}
        placeholder="Instructions — the full text delivered when the skill activates"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        required
      />
      <div className="flex gap-2 self-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!name || !description || !instructions}
          onClick={create}
        >
          Create skill
        </Button>
      </div>
    </form>
  )
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-[7px] text-secondary ${
        active
          ? "bg-surface-selected text-ink-primary"
          : "bg-surface-card text-ink-muted hover:bg-surface-control"
      }`}
    >
      {label}
    </button>
  )
}

const field =
  "w-full resize-y rounded-control border border-line-strong bg-surface-inset px-3 py-2 text-secondary text-ink-body outline-none focus:border-line-accent"

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : "Something went wrong."
  if (message === "skill_exists") return "A skill with that name already exists."
  if (message === "skills_full")
    return "This agent has too many enabled skills — disable one first."
  if (message === "admin_required") return "Only an admin can manage the org directory."
  return message
}
