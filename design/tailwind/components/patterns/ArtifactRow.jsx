import React from "react"

/* Artifact types are three-letter mono badges: DIF, LOG, MD, TXT, PDF. */
export function ArtifactRow({ type, name, meta, metaTone = "faint", onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[11px] rounded-row border border-line-inset bg-surface-card-hover px-3 py-[11px] ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-monogram bg-surface-control font-mono text-[9px] text-ink-monogram">
        {type}
      </div>
      <div className="text-secondary">
        {name}
        <div
          className={`mt-0.5 font-mono text-mono ${metaTone === "working" ? "text-status-working" : "text-ink-faint"}`}
        >
          {meta}
        </div>
      </div>
    </div>
  )
}
