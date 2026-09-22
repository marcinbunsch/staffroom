import { useState } from "react"
import { Button } from "../../design/index.ts"
import { type ConfigFieldRow } from "../../lib/api.ts"

export const field =
  "rounded-control border border-line-strong bg-surface-inset px-3 py-2 text-secondary text-ink-body outline-none focus:border-line-accent"

export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return "Something went wrong."
}

export interface AdminUser {
  id: string
  email: string
  name?: string
  role?: string | null
  banned?: boolean | null
}

/** A back arrow plus the current sub-view's title. */
export function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-secondary text-ink-muted hover:text-ink-primary"
    >
      <i className="ti ti-arrow-left" /> {label}
    </button>
  )
}

export function PickCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: string
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1.5 rounded-card border border-line-default bg-surface-card px-4 py-3.5 text-left hover:border-line-strong hover:bg-surface-hover"
    >
      <span className="flex items-center gap-2 font-semibold text-ink-primary">
        <i className={`ti ${icon} text-[17px] text-ink-muted`} /> {title}
      </span>
      <span className="text-meta text-ink-faint">{description}</span>
    </button>
  )
}

/**
 * A config-field form → one JSON secret. Shared by an org-key tool and an
 * integration: renders the declared fields, validates the required ones, and
 * shows connected/disconnect once set.
 */
export function ConfigConnect({
  fields,
  isAdmin,
  connected,
  onConnect,
  onDisconnect,
}: {
  fields: ConfigFieldRow[]
  isAdmin: boolean
  connected: boolean
  onConnect: (secret: string) => Promise<void> | void
  onDisconnect: () => Promise<void> | void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const effective =
    fields.length > 0 ? fields : [{ key: "secret", label: "Secret", secret: true, optional: false }]
  const missing = effective.some((f) => !f.optional && !values[f.key]?.trim())

  if (connected) {
    return isAdmin ? (
      <Button variant="danger" onClick={() => void onDisconnect()}>
        Disconnect
      </Button>
    ) : (
      <p className="text-meta text-ink-faint">Configured.</p>
    )
  }
  if (!isAdmin) return <p className="text-meta text-ink-faint">Ask an admin to configure this.</p>

  return (
    <div className="flex flex-col gap-2">
      {effective.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-meta text-ink-muted">
            {f.label}
            {f.optional && <span className="ml-1 text-ink-faint">· optional</span>}
          </span>
          <input
            type={f.secret ? "password" : "text"}
            value={values[f.key] ?? ""}
            onChange={(event) => setValues((c) => ({ ...c, [f.key]: event.target.value }))}
            placeholder={f.placeholder}
            className={field}
          />
        </label>
      ))}
      <Button
        variant="primary"
        disabled={missing}
        className="self-start"
        onClick={async () => {
          const map: Record<string, string> = {}
          for (const f of effective) {
            const value = values[f.key]?.trim()
            if (value) map[f.key] = value
          }
          await onConnect(JSON.stringify(map))
          setValues({})
        }}
      >
        Connect
      </Button>
    </div>
  )
}
