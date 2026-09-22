import { useEffect, useState } from "react"
import { useTheme } from "../../lib/use-theme.ts"
import { chartPalette } from "./palette.ts"
import { ChartError, ChartFrame, ChartLoading } from "./ChartFrame.tsx"

/**
 * A ```dot (Graphviz) fence: a text-described diagram (flowchart, ER, state,
 * dependency graph) rendered to SVG. Unlike mermaid, Graphviz renders natively —
 * it is compiled to WebAssembly (@viz-js/viz), so no browser engine is needed
 * and the same source renders server-side for PDF export. It is large and rarely
 * needed, so it is code-split behind a dynamic import: the chunk loads only when
 * a diagram first appears.
 *
 * Diagrams theme with the product palette (passed as default graph/node/edge
 * attributes) and re-render on a light/dark flip. Untrusted input: agents write
 * these. Graphviz emits no scripts, but a `URL` attribute becomes an SVG <a>, so
 * we strip javascript: links and inline handlers before the SVG reaches the DOM.
 */
export function GraphvizChart({ source }: { source: string }) {
  const theme = useTheme()
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; svg: string } | { status: "error" }
  >({ status: "loading" })

  useEffect(() => {
    let live = true
    setState({ status: "loading" })
    void (async () => {
      try {
        const { instance } = await import("@viz-js/viz")
        const viz = await instance()
        if (!live) return
        const palette = chartPalette()
        const fontFamily =
          getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() ||
          "sans-serif"
        // Graphviz takes hex colours directly (the theme vars are authored as
        // hex), so the product palette drives the node outline, edge lines, and
        // label ink. These are *default* attributes, which the DOT source can
        // override — so theme the outline and ink (which survive) rather than a
        // fill (a source-level `style=rounded`/`filled` wins over ours, leaving
        // light ink on an unfilled node = invisible). Outlined nodes with dark,
        // readable ink read cleanly in both themes whatever style the source sets.
        const accent = palette.categorical[0] ?? palette.accent
        // `renderString` defaults to Graphviz's canonical "dot" format; ask for
        // SVG explicitly or the layout text renders as raw markup.
        const raw = viz.renderString(source, {
          format: "svg",
          graphAttributes: {
            bgcolor: "transparent",
            fontname: fontFamily,
            // More room between ranks/nodes so edge labels stop colliding.
            nodesep: "0.4",
            ranksep: "0.6",
          },
          nodeAttributes: {
            color: accent,
            fontcolor: palette.text,
            fontname: fontFamily,
            fontsize: "13",
          },
          edgeAttributes: {
            color: palette.textMuted,
            fontcolor: palette.text,
            fontname: fontFamily,
            // Smaller than the node ink so the midpoint labels stay compact.
            fontsize: "11",
          },
        })
        if (live) setState({ status: "ready", svg: sanitizeSvg(raw) })
      } catch {
        if (live) setState({ status: "error" })
      }
    })()
    return () => {
      live = false
    }
  }, [source, theme])

  if (state.status === "loading") return <ChartLoading />
  if (state.status === "error") return <ChartError source={source} label="graphviz" />
  return (
    <ChartFrame
      label="Diagram"
      expand={
        <div
          // The enlarged copy fills the dialog; the SVG scales to fit its box.
          className="graphviz-chart flex h-full w-full items-center justify-center [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      }
    >
      <div
        className="graphviz-chart flex justify-center [&>svg]:h-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    </ChartFrame>
  )
}

/**
 * Strip the scriptable vectors from Graphviz's SVG before it is injected as HTML.
 * Graphviz never emits <script>, but a node's `URL`/`href` attribute becomes an
 * anchor, so neutralise `javascript:` links and any inline event handlers.
 */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/((?:xlink:)?href)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/((?:xlink:)?href)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'")
}
