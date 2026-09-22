import { useEffect, useId, useState } from "react"
import { useTheme } from "../../lib/use-theme.ts"
import { chartPalette } from "./palette.ts"
import { ChartError, ChartFrame, ChartLoading } from "./ChartFrame.tsx"

/**
 * A ```mermaid fence: a text-described diagram (flowchart, sequence, gantt, ER,
 * …) rendered to SVG. Mermaid is large and rarely needed, so it is code-split
 * behind a dynamic import — the chunk loads only when a diagram first appears.
 *
 * Diagrams theme with the product palette and re-render on a light/dark flip.
 * Untrusted input: agents write these, so mermaid runs with securityLevel
 * "strict" (no click handlers, HTML labels escaped). A source that will not
 * parse shows its raw text rather than throwing away the transcript.
 */
export function MermaidChart({ source }: { source: string }) {
  const theme = useTheme()
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "")
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; svg: string } | { status: "error" }
  >({ status: "loading" })

  useEffect(() => {
    let live = true
    setState({ status: "loading" })
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default
        const palette = chartPalette()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-sans"),
          themeVariables: {
            background: "transparent",
            // Node boxes are saturated fills, so their label ink is the theme's
            // inverse (onAccent) — not the muted body text, which vanishes on a
            // coloured fill. The amber tertiary fill is bright in both themes and
            // takes dark ink instead.
            primaryColor: palette.categorical[0],
            primaryTextColor: palette.onAccent,
            primaryBorderColor: palette.categorical[0],
            secondaryColor: palette.categorical[1],
            secondaryTextColor: palette.onAccent,
            secondaryBorderColor: palette.categorical[1],
            tertiaryColor: palette.categorical[2],
            tertiaryTextColor: palette.onAttention,
            tertiaryBorderColor: palette.categorical[2],
            nodeTextColor: palette.onAccent,
            lineColor: palette.textMuted,
            textColor: palette.text,
            // Edge labels (Yes/No) sit on a neutral plate that matches the card;
            // their dark ink is set in app.css (`.mermaid-chart .edgeLabel`),
            // since mermaid ties node- and edge-label text to one variable and
            // the node boxes need the light on-fill ink instead.
            edgeLabelBackground: palette.surface,
          },
        })
        // `render` is keyed by id; a fresh id per attempt avoids collisions with
        // a prior diagram left in mermaid's internal cache.
        const { svg } = await mermaid.render(`mmd-${baseId}-${theme}`, source)
        if (live) setState({ status: "ready", svg })
      } catch {
        if (live) setState({ status: "error" })
      }
    })()
    return () => {
      live = false
    }
  }, [source, theme, baseId])

  if (state.status === "loading") return <ChartLoading />
  if (state.status === "error") return <ChartError source={source} label="mermaid" />
  return (
    <ChartFrame
      label="Diagram"
      expand={
        <div
          // The enlarged copy fills the dialog; the SVG scales to fit its box.
          // Sanitised by mermaid (securityLevel "strict") before it reaches us.
          className="mermaid-chart flex h-full w-full items-center justify-center [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      }
    >
      {/* Sanitised by mermaid (securityLevel "strict") before it reaches us. */}
      <div
        className="mermaid-chart flex justify-center"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    </ChartFrame>
  )
}
