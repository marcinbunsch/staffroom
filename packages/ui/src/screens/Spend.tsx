import { useCallback, useEffect, useState } from "react"
import { SectionHeader } from "../design/index.ts"
import { type Me, type SpendDimension, type SpendRow, type StaffRow, api } from "../lib/api.ts"
import { money, tokens } from "../lib/format.ts"

const DIMENSIONS: { key: SpendDimension; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "model", label: "Model" },
  { key: "credential", label: "Credential" },
  { key: "session", label: "Session" },
]

/**
 * Spend — a GROUP BY over the priced audit columns. Every signed-in user sees
 * their own, by a dimension; an admin also sees the across-tenants total. A
 * v2-new admin surface (M2); the prototype had no per-tenant spend to port.
 *
 * The stated limit: only model turns are priced. A tool call that costs money
 * (a Firecrawl scrape) is not here — said on the page, not just in a doc.
 */
export function Spend({ me, roster }: { me: Me; roster: StaffRow[] }) {
  const [dimension, setDimension] = useState<SpendDimension>("agent")
  const [rows, setRows] = useState<SpendRow[]>([])
  const [orgRows, setOrgRows] = useState<SpendRow[]>()

  const reload = useCallback(() => {
    api.spend.get(dimension).then(
      (r) => setRows(r.rows),
      () => setRows([]),
    )
  }, [dimension])
  useEffect(() => reload(), [reload])

  useEffect(() => {
    if (me.role === "admin") api.spend.admin().then(setOrgRows, () => setOrgRows([]))
  }, [me.role])

  const label = (row: SpendRow) =>
    dimension === "agent" ? (roster.find((m) => m.id === row.key)?.name ?? row.key) : row.key

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Spend</h1>
          <p className="text-meta text-ink-faint">
            Model turns only — a tool call that costs money (a web scrape, an API call) is not
            counted here.
          </p>
        </header>

        <section>
          <div className="mb-4 flex items-center gap-3">
            <SectionHeader tone="neutral" meta={<Total rows={rows} />}>
              Your spend
            </SectionHeader>
          </div>
          <div className="mb-3 flex items-center overflow-hidden rounded-control border border-line-strong self-start w-fit">
            {DIMENSIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDimension(d.key)}
                className={`px-3 py-[7px] text-secondary ${
                  dimension === d.key
                    ? "bg-surface-selected text-ink-primary"
                    : "bg-surface-card text-ink-muted hover:bg-surface-control"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <SpendTable
            rows={rows}
            label={label}
            keyHead={DIMENSIONS.find((d) => d.key === dimension)?.label ?? "Key"}
          />
        </section>

        {orgRows && (
          <section>
            <SectionHeader tone="neutral" meta={<Total rows={orgRows} />}>
              Across the organization
            </SectionHeader>
            <div className="mt-4">
              <SpendTable rows={orgRows} label={(row) => row.key} keyHead="Tenant" />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function SpendTable({
  rows,
  label,
  keyHead,
}: {
  rows: SpendRow[]
  label: (row: SpendRow) => string
  keyHead: string
}) {
  if (rows.length === 0) {
    return <div className="text-secondary text-ink-muted">No priced turns yet.</div>
  }
  return (
    <div className="overflow-hidden rounded-card border border-line-default">
      <table className="w-full text-secondary">
        <thead>
          <tr className="border-b border-line-default bg-surface-panel text-left text-label uppercase tracking-[0.6px] text-ink-label">
            <th className="px-4 py-2.5 font-semibold">{keyHead}</th>
            <th className="px-4 py-2.5 text-right font-semibold">Turns</th>
            <th className="px-4 py-2.5 text-right font-semibold">Tokens</th>
            <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.key}-${index}`}
              className="border-b border-line-subtle last:border-b-0 hover:bg-surface-card"
            >
              <td className="px-4 py-2.5 text-ink-body">{label(row)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-mono text-ink-muted">
                {row.turns.toLocaleString()}
              </td>
              <td
                className="px-4 py-2.5 text-right font-mono text-mono text-ink-muted"
                title={`in ${row.tokensIn.toLocaleString()} · out ${row.tokensOut.toLocaleString()} · cache read ${row.cacheRead.toLocaleString()}`}
              >
                {tokens(row.tokensIn + row.tokensOut)}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-mono text-ink-primary">
                {money(row.costTotal) ?? "$0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Total({ rows }: { rows: SpendRow[] }) {
  const cost = rows.reduce((sum, row) => sum + row.costTotal, 0)
  return <span>{money(cost) ?? "$0"} total</span>
}
