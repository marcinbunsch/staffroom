import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { CodeBlock } from "./charts/CodeBlock.tsx"

/**
 * Assistant replies are markdown. Kept minimal; the theme styles the elements.
 *
 * Memoised on `children`: the transcript re-renders on every streamed token, so
 * without this every settled message re-parses its markdown each frame — ten
 * visible messages is ten GFM parses per delta, which hangs the stream. Skipping
 * unchanged text keeps the only live parse the one message still growing.
 *
 * Every link opens outside the app (a new tab in the browser; the system browser
 * in the desktop build). A ```mermaid or ```vega-lite fence renders as a chart
 * (see {@link CodeBlock}); every other fence stays a plain code block.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
          pre: CodeBlock,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
