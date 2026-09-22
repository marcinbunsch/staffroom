import {
  type ComponentPropsWithoutRef,
  isValidElement,
  lazy,
  type ReactNode,
  Suspense,
} from "react"
import { ChartLoading } from "./ChartFrame.tsx"

/**
 * The `pre` override for {@link import("../Markdown.tsx").Markdown}. A fenced
 * block tagged with a chart language becomes a chart; everything else stays the
 * plain <pre> react-markdown would have produced. We hook `pre`, not `code`, so
 * a chart replaces the whole block — a <div> nested inside <pre> is invalid, and
 * inline `code` never reaches here.
 *
 * Each chart component is `lazy`, so the rule is uniform: nothing for a given
 * chart kind — neither the wrapper nor its (already dynamically imported)
 * rendering library — is fetched until a fence of that language actually
 * appears. Markdown with no charts pulls in no chart code at all. Add a language
 * here and it works everywhere markdown renders (chat, artifacts, summaries).
 */
const GraphvizChart = lazy(() =>
  import("./GraphvizChart.tsx").then((m) => ({ default: m.GraphvizChart })),
)
const MermaidChart = lazy(() =>
  import("./MermaidChart.tsx").then((m) => ({ default: m.MermaidChart })),
)
const VegaChart = lazy(() => import("./VegaChart.tsx").then((m) => ({ default: m.VegaChart })))

export function CodeBlock({ children, ...preProps }: ComponentPropsWithoutRef<"pre">) {
  const chart = chartFor(codeLanguage(children), codeText(children))
  // `ChartLoading` shows while the component chunk loads; the component then
  // shows its own loading state while its rendering library streams in.
  if (chart) return <Suspense fallback={<ChartLoading />}>{chart}</Suspense>
  return <pre {...preProps}>{children}</pre>
}

/** Map a fence language to its chart, or `undefined` for a plain code block. */
function chartFor(lang: string | undefined, source: string): ReactNode {
  if (lang === "dot" || lang === "graphviz") return <GraphvizChart source={source} />
  if (lang === "mermaid") return <MermaidChart source={source} />
  if (lang === "vega-lite" || lang === "vegalite") return <VegaChart source={source} />
  return undefined
}

/** The `language-xxx` tag react-markdown puts on the inner <code>, or undefined. */
function codeLanguage(children: ReactNode): string | undefined {
  if (!isValidElement(children)) return undefined
  const className = (children.props as { className?: string }).className ?? ""
  return /language-([\w-]+)/.exec(className)?.[1]
}

/** The fence's raw text, from the inner <code>'s children. */
function codeText(children: ReactNode): string {
  if (!isValidElement(children)) return ""
  const inner = (children.props as { children?: ReactNode }).children
  const text = Array.isArray(inner) ? inner.join("") : String(inner ?? "")
  return text.replace(/\n$/, "")
}
