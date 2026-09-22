import { useEffect, useState } from "react"
import { api } from "../lib/api.ts"

/**
 * Pick a model for the chosen credential. Fetches the credential's available
 * models and offers them as a dropdown, with a blank "default" option (an agent
 * that names no model falls back to the default credential's model). When the
 * credential can't list models — none chosen yet, an API-key upstream, or the
 * fetch failed — it degrades to a free-text field so a model can still be typed.
 */
export function ModelPicker({
  credentialId,
  value,
  onChange,
  className,
  allowDefault = true,
}: {
  /** The credential whose models to offer; empty means none chosen. */
  credentialId: string
  value: string
  onChange: (model: string) => void
  className?: string
  /** Offer a blank "default model" choice (agent forms); false to force a pick. */
  allowDefault?: boolean
}) {
  const [models, setModels] = useState<string[]>()

  useEffect(() => {
    if (!credentialId) {
      setModels(undefined)
      return
    }
    let live = true
    setModels(undefined)
    api.models.models(credentialId).then(
      (list) => live && setModels(list),
      () => live && setModels([]),
    )
    return () => {
      live = false
    }
  }, [credentialId])

  // No listing to offer: type the id. Covers no-credential, api-key upstreams,
  // and a Codex/models endpoint that returned nothing or errored.
  if (!credentialId || (models && models.length === 0)) {
    return (
      <input
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="model id"
      />
    )
  }

  if (!models) {
    return (
      <select className={className} disabled>
        <option>Loading models…</option>
      </select>
    )
  }

  return (
    <select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      {allowDefault && <option value="">Default model</option>}
      {/* Keep a stored id that is no longer offered, so editing doesn't drop it. */}
      {value && !models.includes(value) && <option value={value}>{value} (current)</option>}
      {models.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  )
}
