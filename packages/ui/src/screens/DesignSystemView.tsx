import { type ReactNode, useState } from "react"
import { Link } from "react-router"
import logoUrl from "../assets/logo-transparent.png"
import {
  AgentWorkCard,
  ArtifactRow,
  AttentionRow,
  Avatar,
  Button,
  DesignComposer,
  DropZone,
  KindChip,
  MemoryNote,
  Message,
  ProgressBar,
  ProposalRow,
  PrivacyBadge,
  RosterRow,
  SectionHeader,
  StatusDot,
  ToolChip,
  UnreadBadge,
} from "../design/index.ts"

/**
 * The design system, rebuilt in-app. Every token table below is literal
 * Tailwind utilities from our own theme.css; every component specimen renders
 * the real ported primitives from src/design. If this page reads correctly in
 * both themes, the Phase 0 foundation is proven end to end — not screenshotted.
 *
 * A faithful port of design/design-system.html, with the two reference-build
 * iframes replaced by the composition note (the live screens are this app).
 */

const SECTIONS: { id: string; label: string }[] = [
  { id: "color", label: "Color" },
  { id: "type", label: "Type" },
  { id: "radius", label: "Radius" },
  { id: "layout", label: "Layout" },
  { id: "motion", label: "Motion" },
  { id: "icons", label: "Icons" },
  { id: "core", label: "Core components" },
  { id: "patterns", label: "Patterns" },
  { id: "screens", label: "Screens" },
  { id: "rules", label: "Rules" },
  { id: "never", label: "Never" },
]

type Swatch = { varName: string; name: string; note: string }

const SURFACES: Swatch[] = [
  { varName: "--surface-canvas", name: "bg-surface-canvas", note: "page ground" },
  { varName: "--surface-rail", name: "bg-surface-rail", note: "left rail, tab bar" },
  { varName: "--surface-rail-alt", name: "bg-surface-rail-alt", note: "context panel" },
  { varName: "--surface-panel", name: "bg-surface-panel", note: "inset panel, memory note" },
  { varName: "--surface-card", name: "bg-surface-card", note: "cards, rows" },
  { varName: "--surface-card-hover", name: "bg-surface-card-hover", note: "attention rows" },
  { varName: "--surface-selected", name: "bg-surface-selected", note: "active nav item" },
  { varName: "--surface-hover", name: "bg-surface-hover", note: "row hover" },
  { varName: "--surface-control", name: "bg-surface-control", note: "buttons, monograms" },
  {
    varName: "--surface-control-hover",
    name: "bg-surface-control-hover",
    note: "primary button rest",
  },
  {
    varName: "--surface-control-active",
    name: "bg-surface-control-active",
    note: "primary button hover",
  },
  { varName: "--surface-inset", name: "bg-surface-inset", note: "progress track, chips" },
  { varName: "--surface-attention", name: "bg-surface-attention", note: "question block ground" },
  { varName: "--surface-confidential", name: "bg-surface-confidential", note: "privacy ground" },
  {
    varName: "--surface-confidential-strong",
    name: "bg-surface-confidential-strong",
    note: "privacy monogram",
  },
]

const LINES: Swatch[] = [
  { varName: "--line-subtle", name: "border-line-subtle", note: "list dividers" },
  { varName: "--line-default", name: "border-line-default", note: "card border" },
  { varName: "--line-inset", name: "border-line-inset", note: "nested row border" },
  { varName: "--line-strong", name: "border-line-strong", note: "header rules, controls" },
  { varName: "--line-control", name: "border-line-control", note: "filled button edge" },
  { varName: "--line-attention", name: "border-line-attention", note: "amber card edge" },
  { varName: "--line-danger", name: "border-line-danger", note: "danger button edge" },
  { varName: "--line-failed", name: "border-line-failed", note: "failed card edge" },
  { varName: "--line-confidential", name: "border-line-confidential", note: "privacy edge" },
  { varName: "--line-accent", name: "border-line-accent", note: "card hover edge" },
]

const INKS: Swatch[] = [
  { varName: "--ink-primary", name: "text-ink-primary", note: "titles, names" },
  { varName: "--ink-body", name: "text-ink-body", note: "agent prose" },
  { varName: "--ink-secondary", name: "text-ink-secondary", note: "row body" },
  { varName: "--ink-muted", name: "text-ink-muted", note: "supporting copy" },
  { varName: "--ink-meta", name: "text-ink-meta", note: "metadata" },
  { varName: "--ink-faint", name: "text-ink-faint", note: "timestamps" },
  { varName: "--ink-label", name: "text-ink-label", note: "kickers" },
  { varName: "--ink-disabled", name: "text-ink-disabled", note: "masked text" },
  { varName: "--ink-monogram", name: "text-ink-monogram", note: "monogram letters" },
]

const STATUS: Swatch[] = [
  {
    varName: "--status-working",
    name: "bg-status-working",
    note: "running now — the only animated state",
  },
  { varName: "--status-attention", name: "bg-status-attention", note: "text, dots, spines" },
  {
    varName: "--status-attention-fill",
    name: "bg-status-attention-fill",
    note: "approve buttons, unread badges",
  },
  { varName: "--status-failed", name: "bg-status-failed", note: "stopped, will not retry" },
  { varName: "--status-done", name: "bg-status-done", note: "finished" },
  { varName: "--status-idle", name: "bg-status-idle", note: "nothing assigned" },
  {
    varName: "--status-confidential",
    name: "bg-status-confidential",
    note: "private / local only",
  },
  {
    varName: "--status-working-dim",
    name: "bg-status-working-dim",
    note: "working, secondary text",
  },
  { varName: "--status-failed-ink", name: "bg-status-failed-ink", note: "failed text on tint" },
  {
    varName: "--status-attention-ink",
    name: "bg-status-attention-ink",
    note: "text on amber fill",
  },
  { varName: "--tint-attention", name: "bg-tint-attention", note: "amber 12% wash" },
  { varName: "--tint-failed", name: "bg-tint-failed", note: "red 12% wash" },
  {
    varName: "--status-confidential-strong",
    name: "bg-status-confidential-strong",
    note: "privacy emphasis",
  },
]

type TypeRow = { cls: string; extra: string; px: string; note: string }
const TYPE: TypeRow[] = [
  {
    cls: "text-title",
    extra: "font-semibold",
    px: "26px / 1.2 / -0.3px",
    note: "page title — one per screen",
  },
  { cls: "text-heading", extra: "font-semibold", px: "16px", note: "section heading" },
  { cls: "text-subheading", extra: "", px: "15px", note: "panel title, agent name" },
  { cls: "text-body", extra: "", px: "14px", note: "default body, messages" },
  { cls: "text-secondary", extra: "", px: "13px", note: "row copy, buttons" },
  { cls: "text-meta", extra: "", px: "12px", note: "metadata, helper copy" },
  { cls: "text-mono", extra: "font-mono", px: "11px", note: "machine facts, counters" },
  { cls: "text-label", extra: "font-mono", px: "10px / 0.7px", note: "kickers, badges, monograms" },
]

type RadiusRow = { cls: string; px: string; note: string }
const RADII: RadiusRow[] = [
  { cls: "rounded-chip", px: "6px", note: "tool chips" },
  { cls: "rounded-monogram", px: "7px", note: "avatars, type badges" },
  { cls: "rounded-control", px: "8px", note: "buttons, nav items" },
  { cls: "rounded-row", px: "10px", note: "list rows, artifacts" },
  { cls: "rounded-card", px: "12px", note: "cards" },
  { cls: "rounded-panel", px: "14px", note: "composer" },
]

const LAYOUT: { token: string; px: string; note: string }[] = [
  { token: "w-rail", px: "252px", note: "left rail width" },
  { token: "h-tabbar", px: "82px", note: "mobile tab bar" },
  { token: "max-w-content", px: "1240px", note: "screen content cap" },
  { token: "max-w-copy", px: "720px", note: "prose measure" },
  { token: "max-w-rail-right", px: "336px", note: "context panel" },
]

const ICONS = [
  "home",
  "users",
  "clipboard-list",
  "inbox",
  "calendar-clock",
  "notes",
  "list-search",
  "palette",
  "settings",
  "dots",
  "contrast",
  "chevron-left",
]

const RULES: { title: string; body: string }[] = [
  {
    title: "Color is a status channel",
    body: "Blue is working, amber needs you, red failed, gray idle, teal private. Never color for hierarchy or emphasis.",
  },
  {
    title: "No shadows",
    body: "Depth is a surface step plus a 1px border. There is no elevation scale, so shadow-* never appears.",
  },
  {
    title: "Exceptions first",
    body: "Blocked and failed above running, running above done. The operator should never scroll to find a problem.",
  },
  {
    title: "Motion means live",
    body: "Three animate-* utilities, for work happening right now. No entrance animations, ever.",
  },
  {
    title: "Hover changes color",
    body: "Never geometry. No hover:scale-*, no hover:-translate-y-*, no transform transitions.",
  },
  {
    title: "One breakpoint, chrome only",
    body: "mobile: / desktop: at 900px. Content is fluid via flex-wrap, clamp() and auto-fit grids.",
  },
  {
    title: "Mono for machine facts",
    body: "Ids, counts, durations, exit codes, tool scopes, paths. Language is always sans.",
  },
  {
    title: "Privacy reassures",
    body: "Describe the mechanism — “never leaves this machine”, “retained 90 days”. Teal, not red. No shields.",
  },
  {
    title: "Counts carry context",
    body: "“3 open · 1 failure”, not “3”. A bare number is a metric, not information.",
  },
  {
    title: "Name the action",
    body: "“Retry 8 sources”, “Private prep only”. Buttons are verbs with objects.",
  },
]

const NEVER: { code: string; desc: string }[] = [
  {
    code: "bg-neutral-900, text-slate-400, bg-blue-500",
    desc: "Any stock Tailwind palette color. Use bg-surface-*, text-ink-*, *-status-*.",
  },
  {
    code: "dark:*",
    desc: "Theming is data-theme on html plus the variable layer. A dark: variant doubles every decision and drifts.",
  },
  { code: "shadow-sm, shadow-lg, drop-shadow-*", desc: "No shadows in this system, at any size." },
  {
    code: "sm: md: lg: xl: 2xl:",
    desc: "Unused. The only breakpoint variants are mobile: and desktop:.",
  },
  {
    code: "max-w-prose",
    desc: "Tailwind’s static 65ch utility — a theme token cannot override it. The 720px measure is max-w-copy.",
  },
  { code: "hover:scale-105, hover:-translate-y-0.5", desc: "Hover changes color only." },
  {
    code: "animate-pulse, animate-spin, animate-bounce",
    desc: "Tailwind’s stock animations. Use animate-pulse-dot / pulse-ring / bar-slide.",
  },
  {
    code: "rounded-full on cards, rounded-2xl",
    desc: "Radius comes from the six-step scale. Full round is for dots and badges only.",
  },
  {
    code: "Emoji, gradient backgrounds, icon-as-status",
    desc: "Not in this product’s vocabulary. Status is a dot; agents are monograms.",
  },
]

export function DesignSystemView() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  )

  // Ephemeral visual check — flips data-theme directly so both themes can be
  // eyeballed here. The stored preference reasserts on the next full load.
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light"
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="flex min-h-screen bg-surface-canvas text-ink-primary">
      <aside className="sticky top-0 hidden h-screen w-[228px] flex-[0_0_228px] flex-col border-r border-line-default bg-surface-rail px-3.5 py-6 desktop:flex">
        <div className="flex items-center gap-2.5 px-2">
          <img src={logoUrl} alt="" className="block h-[26px] w-[26px] object-contain" />
          <div className="text-secondary font-semibold tracking-[0.2px]">Design system</div>
        </div>
        <div className="mt-1.5 px-2 font-mono text-label tracking-[0.4px] text-ink-label">
          TAILWIND V4
        </div>
        <nav className="mt-6 flex flex-col gap-px">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollTo(section.id)}
              className="rounded-control px-2.5 py-[7px] text-left text-secondary text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-transparent px-2.5 py-2 text-secondary text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
          >
            <i className="ti ti-contrast text-[15px]" />
            Toggle theme · {theme}
          </button>
          <Link
            to="/"
            className="rounded-control px-2.5 py-[7px] text-meta text-ink-faint hover:text-ink-primary"
          >
            ← Back to app
          </Link>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-surface-canvas">
        <div className="flex items-center gap-3 border-b border-line-default bg-surface-canvas px-4 pt-[env(safe-area-inset-top)] pb-3 desktop:hidden">
          <img src={logoUrl} alt="" className="block h-[24px] w-[24px] object-contain" />
          <div className="text-secondary font-semibold">Design system</div>
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-auto grid h-8 w-8 cursor-pointer place-items-center rounded-control border border-line-strong text-ink-muted"
          >
            <i className="ti ti-contrast text-[15px]" />
          </button>
        </div>

        <div className="flex max-w-content flex-col gap-9 px-[clamp(16px,4vw,44px)] pt-[clamp(24px,4vw,40px)] pb-16">
          <header>
            <div className="font-mono text-label tracking-[0.7px] uppercase text-ink-label">
              Staff · rebuilt in-app from the ported primitives
            </div>
            <h1 className="mt-2.5 text-title font-semibold">Tailwind design system</h1>
            <p className="mt-3 max-w-copy text-body text-ink-muted text-pretty">
              Every token table below is literal utilities from our own theme.css; every component
              specimen renders the real components in src/design. If this reads correctly in light
              and dark, the Phase 0 foundation is proven. Toggle the theme in the rail to check
              both.
            </p>
          </header>

          <Section
            id="color"
            title="Color"
            intro="Color is a status channel, not decoration. Hierarchy comes from ink steps and surface steps; emphasis comes from weight. At rest a screen shows at most one amber block and one red block."
          >
            <div className="flex flex-col gap-6">
              <SwatchGroup label="Surfaces — bg-surface-*" items={SURFACES} />
              <SwatchGroup label="Borders — border-line-*" items={LINES} />
              <div>
                <SwatchGroup label="Text — text-ink-*" items={INKS} />
                <p className="mt-2.5 max-w-copy text-meta text-ink-faint text-pretty">
                  Renamed from --text-* because Tailwind v4 reserves that namespace for font sizes.
                </p>
              </div>
              <SwatchGroup label="Status — *-status-* and bg-tint-*" items={STATUS} />
            </div>
          </Section>

          <Section
            id="type"
            title="Type"
            intro="IBM Plex Sans for language, IBM Plex Mono for machine facts — ids, counts, durations, exit codes, tool and scope names. Weights: 400, 500, 600. Nothing is bold for emphasis alone."
          >
            <div className="rounded-card border border-line-default bg-surface-card divide-y divide-line-subtle">
              {TYPE.map((row) => (
                <div
                  key={row.cls}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 px-4 py-3.5"
                >
                  <div className="flex-[0_0_150px] font-mono text-mono text-ink-secondary">
                    {row.cls}
                  </div>
                  <div
                    className={`min-w-0 flex-[1_1_220px] ${row.cls} ${row.extra} text-ink-primary`}
                  >
                    Marta’s 1:1 brief
                  </div>
                  <div className="flex-[0_0_170px] font-mono text-[10px] text-ink-faint">
                    {row.px}
                  </div>
                  <div className="flex-[1_1_160px] text-meta text-ink-meta">{row.note}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="radius"
            title="Radius"
            intro="Six steps, chosen by element size. Nothing is fully round except dots and badges."
          >
            <div className="flex flex-wrap gap-3">
              {RADII.map((r) => (
                <div key={r.cls} className="flex flex-col items-center gap-2">
                  <div
                    className={`grid h-16 w-16 place-items-center border border-line-strong bg-surface-control ${r.cls}`}
                  />
                  <div className="font-mono text-mono text-ink-secondary">{r.cls}</div>
                  <div className="font-mono text-[10px] text-ink-faint">{r.px}</div>
                  <div className="max-w-[110px] text-center text-[10px] text-ink-meta">
                    {r.note}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="layout"
            title="Layout"
            intro="One breakpoint, and it governs chrome only: the rail becomes a top bar plus bottom tab bar. Content is fluid — flex-wrap with flex-basis, clamp() padding, and auto-fit grids."
          >
            <div className="rounded-card border border-line-default bg-surface-card divide-y divide-line-subtle">
              {LAYOUT.map((row) => (
                <div
                  key={row.token}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3"
                >
                  <div className="flex-[0_0_170px] font-mono text-mono text-ink-secondary">
                    {row.token}
                  </div>
                  <div className="flex-[0_0_80px] font-mono text-[10px] text-ink-faint">
                    {row.px}
                  </div>
                  <div className="flex-[1_1_200px] text-meta text-ink-meta">{row.note}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 max-w-copy text-meta text-ink-faint text-pretty">
              Arbitrary values are correct here. This system’s spacing (18px card padding, 13px
              gaps, 7px dots) predates Tailwind’s 4px scale — p-[18px] is honest; do not round it to
              p-5.
            </p>
          </Section>

          <Section
            id="motion"
            title="Motion"
            intro="Motion means work is happening right now. Idle, done and failed never animate; nothing has an entrance animation; hover changes color, never geometry. All three respect prefers-reduced-motion."
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2.5">
              <div className="rounded-card border border-line-default bg-surface-card flex items-center gap-3.5 p-4">
                <span className="relative h-[9px] w-[9px] shrink-0">
                  <span className="absolute inset-0 animate-pulse-dot rounded-full bg-status-working" />
                </span>
                <div>
                  <div className="font-mono text-mono text-ink-secondary">animate-pulse-dot</div>
                  <div className="mt-0.5 text-[10px] text-ink-meta">2.4s · working dot</div>
                </div>
              </div>
              <div className="rounded-card border border-line-default bg-surface-card flex items-center gap-3.5 p-4">
                <span className="relative h-[9px] w-[9px] shrink-0">
                  <span className="absolute inset-0 animate-pulse-dot rounded-full bg-status-working" />
                  <span className="absolute inset-0 animate-pulse-ring rounded-full border border-status-working" />
                </span>
                <div>
                  <div className="font-mono text-mono text-ink-secondary">animate-pulse-ring</div>
                  <div className="mt-0.5 text-[10px] text-ink-meta">
                    2.4s · active agent in rail
                  </div>
                </div>
              </div>
              <div className="rounded-card border border-line-default bg-surface-card p-4">
                <div className="h-0.5 overflow-hidden rounded-[2px] bg-surface-inset">
                  <div className="h-full w-[30%] animate-bar-slide bg-status-working" />
                </div>
                <div className="mt-3 font-mono text-mono text-ink-secondary">animate-bar-slide</div>
                <div className="mt-0.5 text-[10px] text-ink-meta">2.8s · unknown extent</div>
              </div>
            </div>
            <div className="mt-3.5">
              <Pre>transition-[background-color,color,border-color] duration-[120ms] ease-out</Pre>
            </div>
          </Section>

          <Section
            id="icons"
            title="Icons"
            intro="Tabler Icons webfont, inheriting currentColor. Icons appear in navigation and controls only — never as a status indicator (status is a dot) and never as decoration beside a heading."
          >
            <div className="flex flex-wrap gap-2.5">
              {ICONS.map((icon) => (
                <div
                  key={icon}
                  className="flex items-center gap-2.5 rounded-row border border-line-inset bg-surface-panel px-3 py-2.5"
                >
                  <i className={`ti ti-${icon} text-[17px] text-ink-secondary`} />
                  <span className="font-mono text-[10px] text-ink-faint">ti-{icon}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="core"
            title="Core components"
            intro="Nine primitives, rendered here from src/design. Props are unchanged from the design source; only Button differs — it takes className instead of style."
          >
            <div className="flex flex-col gap-3.5">
              <Specimen
                name="StatusDot"
                desc="The single status vocabulary. A dot, never a glyph, never a colored label."
                notes={["Only working animates. The ring is for the active agent in the rail."]}
              >
                {(["working", "attention", "failed", "done", "idle", "confidential"] as const).map(
                  (status) => (
                    <div key={status} className="flex items-center gap-2.5">
                      <StatusDot status={status} ring />
                      <span className="font-mono text-mono text-ink-faint">{status}</span>
                    </div>
                  ),
                )}
              </Specimen>

              <Specimen
                name="Avatar"
                desc="Two-letter monogram with optional status pip. There is no photography in this product."
                notes={[
                  "The pip’s border color matches the surface behind it.",
                  "Idle agents recede one ink step; they never disappear.",
                ]}
              >
                <Avatar initials="ST" size="sm" />
                <Avatar initials="DE" size="md" />
                <Avatar
                  initials="LE"
                  size="lg"
                  status="working"
                  ringColor="var(--surface-canvas)"
                />
                <Avatar initials="PM" size="lg" idle />
              </Specimen>

              <Specimen
                name="Button"
                desc="Buttons are verbs. At most one amber approve per screen — the only saturated fill in the system."
                notes={[
                  "Label the specific action — “Retry 8 sources”, not “Retry”.",
                  "Nothing transforms on press. No scale, no translate.",
                ]}
              >
                <Button variant="approve">Approve</Button>
                <Button variant="primary">Answer</Button>
                <Button variant="secondary">Review</Button>
                <Button variant="ghost">Later</Button>
                <Button variant="danger">Retry 8 sources</Button>
                <Button variant="primary" disabled>
                  Send
                </Button>
              </Specimen>

              <Specimen
                name="KindChip / ToolChip / PrivacyBadge / UnreadBadge"
                desc="Mono labels. Kind says what a row is; tool chips name machine scopes; privacy is teal, never red."
                notes={[
                  "Privacy copy describes mechanics and reassures — it does not warn.",
                  "Unread is amber because an unread message is something waiting on you.",
                ]}
              >
                <KindChip tone="attention">DECISION</KindChip>
                <KindChip tone="failed">FAILED</KindChip>
                <KindChip tone="neutral">HANDOFF</KindChip>
                <ToolChip>github:read</ToolChip>
                <PrivacyBadge dot>CONFIDENTIAL</PrivacyBadge>
                <UnreadBadge count={2} />
              </Specimen>

              <Specimen
                name="ProgressBar"
                desc="2px. A known extent fills; an unknown extent slides."
                notes={["Always pair the bar with a mono line saying what the number counts."]}
              >
                <div className="w-full max-w-[280px]">
                  <ProgressBar value={62} />
                  <div className="mt-2.5 font-mono text-mono text-ink-faint">
                    184/297 line items
                  </div>
                </div>
                <div className="w-full max-w-[280px]">
                  <ProgressBar value={null} />
                  <div className="mt-2.5 font-mono text-mono text-ink-faint">
                    step 4/6 · extent unknown
                  </div>
                </div>
              </Specimen>

              <Specimen
                name="SectionHeader"
                desc="Uppercase kicker, hairline fading from a status tint, optional mono count. This rhythm repeats on every screen."
                notes={[
                  "The count is context, not a metric — say what it counts, never a bare number.",
                ]}
              >
                <div className="w-full max-w-[520px] flex flex-col gap-4">
                  <SectionHeader tone="attention" meta="3 open · 1 failure">
                    Needs you
                  </SectionHeader>
                  <SectionHeader tone="working" meta="4 jobs · 3 agents">
                    Working now
                  </SectionHeader>
                  <SectionHeader tone="neutral">Recent outcomes</SectionHeader>
                </div>
              </Specimen>
            </div>
          </Section>

          <Section
            id="patterns"
            title="Patterns"
            intro="Ten composed rows and cards, rendered from src/design. These carry the product’s argument: exceptions first, then live work, then outcomes."
          >
            <div className="flex flex-col gap-3.5">
              <Specimen
                name="AttentionRow"
                desc="The most important object in the product. A 3px status spine as a grid column, so it never rounds oddly."
                notes={[
                  "Copy answers three questions in order: what stopped, why, what happens if you act.",
                  "flex-wrap plus flex-[1_1_340px] drops the actions below the copy on narrow screens — no breakpoint.",
                ]}
              >
                <div className="w-full">
                  <AttentionRow
                    kind="DECISION"
                    tone="attention"
                    title="Deploy api-gateway v2.14 to production"
                    body="Devops finished the canary at 5% for 40 minutes with no error-rate change. Needs your go-ahead before the full rollout."
                    agent="Devops"
                    agentInitials="DE"
                    meta={
                      <>
                        <span>waiting 1h 04m</span>
                        <span className="font-mono">job #4192</span>
                      </>
                    }
                    actions={
                      <>
                        <Button variant="secondary">Later</Button>
                        <Button variant="approve">Approve</Button>
                      </>
                    }
                  />
                </div>
              </Specimen>

              <Specimen
                name="AgentWorkCard"
                desc="Live work. Cards raise their border on hover — they never lift or scale."
                notes={[
                  "Say what the agent is doing in plain language, then the machine detail in mono beneath.",
                ]}
              >
                <div className="w-full max-w-[320px]">
                  <AgentWorkCard
                    name="Steward"
                    initials="ST"
                    status="working"
                    work="Preparing Marta’s 1:1 brief"
                    progress={null}
                    left="step 4/6"
                    right="6m 12s"
                    onClick={() => undefined}
                  />
                </div>
              </Specimen>

              <Specimen
                name="RosterRow"
                desc="The staff list. Three tracks that collapse by flex-basis, not a breakpoint."
                notes={["Idle is a legitimate state, shown plainly — never styled as a problem."]}
              >
                <div className="w-full overflow-hidden rounded-card border border-line-default bg-surface-card">
                  <RosterRow
                    name="Devops"
                    initials="DE"
                    role="Deploys & incidents"
                    status="attention"
                    unread={2}
                    work="Canary at 5%, waiting on you"
                    stateLabel="needs approval · 1h 04m"
                    tools="4 tools"
                  />
                  <RosterRow
                    name="PM"
                    initials="PM"
                    role="Roadmap & specs"
                    status="idle"
                    work="Nothing assigned"
                    stateLabel="idle · 6h"
                    tools="2 tools"
                  />
                </div>
              </Specimen>

              <Specimen
                name="ProposalRow"
                desc="Nothing becomes durable without an explicit approval. After a decision the row states what happened and stays undoable."
                notes={[
                  "Always name the destination in mono — the operator should see where a thing will land.",
                ]}
              >
                <div className="flex w-full flex-col gap-2.5">
                  <ProposalRow
                    kind="MEMORY"
                    title="Note Marta’s escalation threshold"
                    scope="private"
                    body="Escalate only blockers older than a day; anything faster is noise."
                    destination="→ memory / escalation"
                  />
                  <ProposalRow
                    kind="MEMORY"
                    title="Remember Marta’s agenda preference"
                    scope="private"
                    body="Written agendas 24h ahead; no surprises in 1:1s."
                    destination="→ memory / 1-1-cadence"
                    decision="approved"
                  />
                </div>
              </Specimen>

              <Specimen
                name="Message / Composer"
                desc="The operator’s bubble is the only asymmetric radius in the system. Agent turns are unbubbled — they are output, not chat."
                notes={[
                  "Work is always addressed to a named agent, so the picker lives in the composer.",
                  "Send stays disabled until there is text.",
                ]}
              >
                <div className="flex w-full max-w-[560px] flex-col gap-4">
                  <Message from="operator">Put together a brief for Marta’s 1:1.</Message>
                  <Message from="agent" initials="ST">
                    Starting now. I’ll keep the private material separate from anything shareable.
                  </Message>
                  <DesignComposer
                    agent="Steward"
                    agentInitials="ST"
                    placeholder="Message Steward…"
                  />
                </div>
              </Specimen>

              <Specimen
                name="ArtifactRow / MemoryNote / DropZone"
                desc="Outputs, remembered facts, and the one dashed border in the system."
                notes={["A sealed note shows its key and its existence, never its content."]}
              >
                <div className="flex w-full max-w-[420px] flex-col gap-2.5">
                  <ArtifactRow
                    type="DIF"
                    name="api-gateway-v2.14.diff"
                    meta="312 lines · 4 files"
                  />
                  <MemoryNote
                    noteKey="1-1-cadence"
                    body="Marta prefers written agendas 24h ahead."
                  />
                  <MemoryNote noteKey="comp-discussions" sealed />
                  <DropZone label="Drop a file, or paste text" />
                </div>
              </Specimen>
            </div>
          </Section>

          <Section
            id="screens"
            title="Screens"
            intro="How the primitives stack into a screen. The two reference builds (staff-home, staff-agent-thread) live in design/; the live screens are this app, rebuilt from Phase 1 onward."
          >
            <div className="rounded-row border border-line-inset bg-surface-panel px-4 py-3.5">
              <div className="text-secondary font-semibold">Composition order, on every screen</div>
              <p className="mt-1.5 max-w-copy text-meta text-ink-muted text-pretty">
                Needs you → Working now → Recent outcomes. A screen never opens with a metric, a
                chart, or a greeting card. If nothing needs the operator, the first section is
                simply absent — no empty state, no “all clear” banner.
              </p>
            </div>
          </Section>

          <Section
            id="rules"
            title="Rules that survive the port"
            intro="These are the ones most easily lost in a utility rewrite."
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-2.5">
              {RULES.map((rule) => (
                <div
                  key={rule.title}
                  className="rounded-row border border-line-inset bg-surface-panel px-4 py-3.5"
                >
                  <div className="text-secondary font-semibold">{rule.title}</div>
                  <p className="mt-1.5 text-meta text-ink-muted text-pretty">{rule.body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="never"
            title="Never"
            intro="If a generated screen contains any of these, it is off-system."
          >
            <div className="rounded-card border border-line-default bg-surface-card divide-y divide-line-subtle">
              {NEVER.map((item) => (
                <div
                  key={item.code}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3.5"
                >
                  <div className="flex-[1_1_260px] font-mono text-mono text-status-failed">
                    {item.code}
                  </div>
                  <div className="flex-[2_1_320px] text-meta text-ink-muted text-pretty">
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </main>
    </div>
  )
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line-subtle pt-9">
      <div className="flex items-center gap-3">
        <h2 className="text-heading font-semibold">{title}</h2>
        <div className="h-px flex-1 bg-line-subtle" />
      </div>
      {intro ? (
        <p className="mt-2.5 max-w-copy text-secondary text-ink-muted text-pretty">{intro}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function SwatchGroup({ label, items }: { label: string; items: Swatch[] }) {
  return (
    <div>
      <div className="font-mono text-label tracking-[0.7px] uppercase text-ink-label mb-2.5">
        {label}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,232px),1fr))] gap-2.5">
        {items.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-3 rounded-row border border-line-inset bg-surface-panel p-2.5"
          >
            <div
              className="h-9 w-9 shrink-0 rounded-monogram border border-line-strong"
              style={{ background: `var(${item.varName})` }}
            />
            <div className="min-w-0">
              <div className="truncate font-mono text-mono text-ink-primary">{item.name}</div>
              <div className="mt-[3px] truncate font-mono text-[10px] text-ink-faint">
                {item.note}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Specimen({
  name,
  desc,
  notes,
  children,
}: {
  name: string
  desc: string
  notes?: string[]
  children: ReactNode
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-strong px-4 py-3">
        <div className="font-mono text-secondary font-medium text-ink-primary">{name}</div>
        <div className="text-meta text-ink-meta text-pretty">{desc}</div>
      </div>
      <div className="flex flex-wrap items-center gap-4 bg-surface-canvas px-4 py-6">
        {children}
      </div>
      {notes ? (
        <div className="border-t border-line-subtle p-3.5">
          <ul className="flex flex-col gap-1.5 pl-4 text-meta text-ink-muted">
            {notes.map((note) => (
              <li key={note} className="list-disc text-pretty">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-row border border-line-inset bg-surface-panel px-3.5 py-3 font-mono text-mono text-ink-secondary whitespace-pre">
      <code>{children}</code>
    </pre>
  )
}
