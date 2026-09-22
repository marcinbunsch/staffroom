import { useEffect, useRef, useState } from "react"
import { useTheme } from "../../lib/use-theme.ts"
import { chartPalette } from "./palette.ts"
import { ChartError, ChartFrame } from "./ChartFrame.tsx"

/**
 * A ```vega-lite fence: a Vega-Lite JSON spec rendered as a real data chart
 * (bar, line, scatter, area, …). vega + vega-lite + vega-embed are heavy, so
 * they load behind a dynamic import — the chunk arrives only when the first
 * data chart does.
 *
 * The spec supplies the data and marks; we supply the theme — colours, fonts,
 * and gridlines from the product palette (see {@link chartPalette}) — merged as
 * Vega config so a chart never ships raw D3 defaults and follows a light/dark
 * flip. A spec that is not valid JSON, or that vega rejects, shows its raw
 * source instead of throwing.
 *
 * `fill` makes the chart size to its box on both axes instead of its intrinsic
 * height — for a dashboard tile the operator resizes. It reflows as the box
 * changes (a ResizeObserver drives the view's size). In chat, where a chart sits
 * in flow with no definite height, `fill` stays off and it keeps its own height.
 */
export function VegaChart({ source, fill = false }: { source: string; fill?: boolean }) {
  const { host, state } = useVegaEmbed(source, fill)

  if (state === "error") return <ChartError source={source} label="vega-lite" />
  // The host stays mounted and full-width the whole time: the ref must be live
  // before the effect runs, and sizing measures this element when embed runs —
  // hiding it (display:none) would measure zero. In fill mode it also grows to
  // the box's remaining height. The loading note sits above; the chart reveals
  // in place below it.
  return (
    <ChartFrame label="Chart" fill={fill} expand={<VegaExpanded source={source} />}>
      {state === "loading" && <RenderingNote />}
      <div ref={host} className={fill ? "min-h-0 w-full flex-1 overflow-hidden" : "w-full"} />
    </ChartFrame>
  )
}

/**
 * The enlarged copy shown in the zoom dialog — a second, independent embed that
 * fills the dialog's width. Mounted only while the dialog is open, so it starts
 * fresh and tears down on close; that also keeps its host distinct from the
 * inline chart's, which a single live SVG node could not be.
 */
function VegaExpanded({ source }: { source: string }) {
  const { host, state } = useVegaEmbed(source)
  return (
    <div className="w-full">
      {state === "loading" && <RenderingNote />}
      {state === "error" && (
        <div className="py-6 text-center text-mono text-status-failed">Could not render chart.</div>
      )}
      <div ref={host} className="w-full" />
    </div>
  )
}

function RenderingNote() {
  return <div className="py-6 text-center text-mono text-ink-muted">Rendering chart…</div>
}

/**
 * Embeds a Vega-Lite spec into a host div, themed with the product palette and
 * re-run on a source, light/dark, or fill change. Returns the host ref to attach
 * and the current render state.
 */
function useVegaEmbed(source: string, fill = false) {
  const theme = useTheme()
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let live = true
    let finalize: (() => void) | undefined
    let observer: ResizeObserver | undefined
    setState("loading")
    void (async () => {
      let spec: Record<string, unknown>
      try {
        spec = JSON.parse(source)
      } catch {
        if (live) setState("error")
        return
      }
      const element = host.current
      if (fill && element) {
        // Fill the box on both axes and reflow on resize (below). We give Vega an
        // explicit pixel size rather than its "container" sizing, which only
        // supports single views and is unreliable for height; `fit` keeps the
        // axes and legend inside the box. Our width/height win over the spec's.
        spec = {
          autosize: { type: "fit", contains: "padding" },
          ...spec,
          width: element.clientWidth,
          height: element.clientHeight,
        }
      } else if (!("width" in spec)) {
        // Flow layout (chat): fill the width, keep the spec's own height.
        // "container" reads the host's width, which is why the host is `w-full`.
        spec = { ...spec, width: "container" }
      }
      try {
        const embed = (await import("vega-embed")).default
        if (!live || !host.current) return
        const result = await embed(host.current, spec as never, {
          actions: false,
          renderer: "svg",
          config: vegaConfig(),
        })
        if (!live) {
          result.finalize()
          return
        }
        finalize = result.finalize
        setState("ready")

        // Reflow the live view as the tile resizes — no re-embed. Coalesced into
        // an animation frame so a drag-resize does not thrash (and to sidestep
        // the ResizeObserver feedback-loop warning).
        if (fill && host.current) {
          const view = result.view
          let frame = 0
          observer = new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect
            if (!box) return
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
              if (!live) return
              // `resize()` is required for the new width/height to take under
              // autosize `fit`; without it the layout is not recomputed.
              view
                .width(Math.max(0, Math.round(box.width)))
                .height(Math.max(0, Math.round(box.height)))
                .resize()
                .run()
            })
          })
          observer.observe(host.current)
        }
      } catch {
        if (live) setState("error")
      }
    })()
    return () => {
      live = false
      observer?.disconnect()
      finalize?.()
    }
  }, [source, theme, fill])

  return { host, state }
}

/** Vega config that themes any spec with the product palette. */
function vegaConfig() {
  const palette = chartPalette()
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim()
  return {
    background: palette.background,
    font,
    range: { category: palette.categorical },
    view: { stroke: "transparent" },
    title: { color: palette.text, subtitleColor: palette.textMuted },
    axis: {
      labelColor: palette.textMuted,
      titleColor: palette.text,
      gridColor: palette.grid,
      domainColor: palette.grid,
      tickColor: palette.grid,
    },
    legend: { labelColor: palette.textMuted, titleColor: palette.text },
    mark: { color: palette.accent },
  }
}
