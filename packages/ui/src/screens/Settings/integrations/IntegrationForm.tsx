import { useState } from "react"
import {
  type IntegrationInputBody,
  type IntegrationRow,
  type IntegrationTypeRow,
  type SandboxRepoRow,
  type TeamRow,
} from "../../../lib/api.ts"
import { TeamSelect, teamsGranting, toggledSet } from "../team-grants.tsx"

/** The register/edit form for an integration instance. */
export function IntegrationForm({
  type,
  existing,
  teams,
  onCancel,
  onSave,
}: {
  type: IntegrationTypeRow
  existing?: IntegrationRow
  teams: TeamRow[]
  onCancel: () => void
  onSave: (input: IntegrationInputBody, teamIds: string[]) => void
}) {
  const isDocker = type.kind === "docker"
  const isGcp = type.kind === "gcp"
  const isToken = type.kind === "token"
  const isOAuth = type.kind === "oauth"
  const isMcp = type.kind === "mcp"
  // Whether the type takes an admin-registered client id/secret. Always true for
  // oauth; true for an mcp type with no dynamic registration (HubSpot), false for
  // one that registers a client automatically (Notion, Sentry).
  const needsClient = type.configFields.some((field) => field.key === "clientId")
  const [label, setLabel] = useState(existing?.label ?? type.label)
  const [name, setName] = useState(existing?.name ?? "")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [serviceAccount, setServiceAccount] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [mcpUrl, setMcpUrl] = useState(existing?.mcpUrl ?? "")
  const [scopes, setScopes] = useState((existing?.scopes ?? type.defaultScopes).join("\n"))
  const [repos, setRepos] = useState<SandboxRepoRow[]>(existing?.repos ?? [])
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    new Set(teamsGranting(teams, existing?.name, (team) => team.integrationGrants)),
  )
  const toggleTeam = (id: string) => setSelectedTeams((prior) => toggledSet(prior, id))

  const inputClass =
    "w-full rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-secondary text-ink-body"

  function save() {
    onSave(
      {
        name,
        label: label.trim() || type.label,
        type: type.type,
        scopes: scopes
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        repos: repos.filter((r) => r.name.trim() && r.path.trim()),
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        serviceAccount: serviceAccount.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        mcpUrl: isToken ? mcpUrl.trim() : undefined,
      },
      [...selectedTeams],
    )
  }

  return (
    <div className="rounded-card border border-line-strong bg-surface-card px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Name
          <input
            className={inputClass}
            value={label}
            placeholder={isDocker ? "Backend repos" : "Slack read-only"}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Slug (grant key)
          <input
            className={inputClass}
            value={name}
            disabled={Boolean(existing)}
            placeholder={isDocker ? "backend" : "slack-read"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {needsClient && (
          <>
            <label className="flex flex-col gap-1 text-meta text-ink-muted">
              Client ID
              <input
                className={inputClass}
                value={clientId}
                placeholder={existing ? "leave blank to keep" : ""}
                onChange={(e) => setClientId(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-meta text-ink-muted">
              Client secret
              <input
                type="password"
                className={inputClass}
                value={clientSecret}
                placeholder={existing ? "leave blank to keep" : ""}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </label>
          </>
        )}
        {isMcp && (
          <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
            MCP server URL
            <input
              readOnly
              value={existing?.mcpUrl ?? type.defaultMcpUrl ?? ""}
              className={`${inputClass} font-mono`}
            />
            <span className="text-meta text-ink-faint">
              {needsClient
                ? "Register an MCP auth app with the provider, add the redirect URI below as its OAuth URL, and paste the client id and secret above. Each person then connects their own account."
                : "No app to register — connecting discovers this server’s OAuth and registers a client automatically. Each person then connects their own account."}
            </span>
          </label>
        )}
        {(isOAuth || isMcp) && (
          <RedirectUriField redirectUri={existing?.redirectUri} inputClass={inputClass} />
        )}
        {isToken && (
          <>
            <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
              API key
              <input
                type="password"
                className={inputClass}
                value={apiKey}
                placeholder={existing ? "leave blank to keep" : "fc-..."}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
              MCP server URL
              <input
                className={`${inputClass} font-mono`}
                value={mcpUrl}
                placeholder={type.defaultMcpUrl ?? "https://..."}
                onChange={(e) => setMcpUrl(e.target.value)}
              />
              <span className="text-meta text-ink-faint">
                Blank uses the default{type.defaultMcpUrl ? ` (${type.defaultMcpUrl})` : ""}. Set it
                to point at a self-hosted server. An MCP toolset for this integration prefills this
                URL.
              </span>
            </label>
          </>
        )}
        {isGcp && (
          <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
            Service account key
            <input
              type="file"
              accept=".json,application/json"
              className="text-secondary text-ink-body file:mr-2 file:rounded-control file:border file:border-line-strong file:bg-surface-inset file:px-2.5 file:py-1 file:text-ink-body"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) setServiceAccount(await file.text())
              }}
            />
            <span className="text-meta text-ink-faint">
              {serviceAccount
                ? "Key loaded — save to store it."
                : existing
                  ? "Upload a new JSON key to replace the stored one, or leave it to keep."
                  : "Upload the service account's JSON key file."}
            </span>
          </label>
        )}
        {!isDocker && !isToken && !isMcp && (
          <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
            Scopes (one per line{isGcp ? "" : " — request only what this app is configured for"})
            <textarea
              className={`${inputClass} min-h-28 font-mono`}
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
          </label>
        )}
      </div>

      {isDocker && <RepoEditor repos={repos} onChange={setRepos} inputClass={inputClass} />}

      <TeamSelect
        teams={teams}
        selected={selectedTeams}
        onToggle={toggleTeam}
        label="Teams that may use this integration"
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || !label.trim()}
          onClick={save}
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {existing ? "Save changes" : "Add integration"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-3 py-1.5 text-secondary text-ink-muted hover:text-ink-body"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The read-only redirect URI to register with the provider (oauth + mcp kinds). */
function RedirectUriField({
  redirectUri,
  inputClass,
}: {
  redirectUri?: string
  inputClass: string
}) {
  return (
    <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
      Redirect URI
      {redirectUri ? (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={redirectUri}
              onFocus={(e) => e.target.select()}
              className={`${inputClass} flex-1 font-mono`}
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(redirectUri)}
              className="shrink-0 rounded-control border border-line-strong px-2.5 py-1.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Copy
            </button>
          </div>
          <span className="text-meta text-ink-faint">
            Add this exact value to the provider’s authorized redirect URIs. It is what the server
            sends (from <code>STAFFROOM_URL</code>).
          </span>
        </>
      ) : (
        <span className="text-meta text-ink-faint">
          Save first — the exact redirect URI to register appears here once the instance exists.
        </span>
      )}
    </label>
  )
}

/** The repos editor for a Docker Sandbox integration (name + local git path). */
function RepoEditor({
  repos,
  onChange,
  inputClass,
}: {
  repos: SandboxRepoRow[]
  onChange: (repos: SandboxRepoRow[]) => void
  inputClass: string
}) {
  const update = (index: number, patch: Partial<SandboxRepoRow>) =>
    onChange(repos.map((repo, i) => (i === index ? { ...repo, ...patch } : repo)))

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-meta text-ink-muted">
        Repositories — each mounted read-only at <code>/repos/&lt;name&gt;.git</code>. Give a mount
        name and the absolute path to a git checkout on this server (its origin is mirrored).
      </div>
      <div className="flex flex-col gap-2">
        {repos.map((repo, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, never reordered
          <div key={i} className="flex gap-2">
            <input
              className={`${inputClass} shrink-0 grow-0 basis-40`}
              value={repo.name}
              placeholder="name"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className={`${inputClass} flex-1 font-mono`}
              value={repo.path}
              placeholder="/abs/path/to/checkout"
              onChange={(e) => update(i, { path: e.target.value })}
            />
            <button
              type="button"
              aria-label="Remove repo"
              onClick={() => onChange(repos.filter((_, idx) => idx !== i))}
              className="rounded-control border border-line-strong px-2 text-ink-muted hover:text-status-failed"
            >
              <i className="ti ti-x" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...repos, { name: "", path: "" }])}
          className="self-start rounded-control border border-line-strong px-2.5 py-1 text-meta text-ink-body hover:bg-line-subtle"
        >
          <i className="ti ti-plus" /> Add repo
        </button>
      </div>
    </div>
  )
}
