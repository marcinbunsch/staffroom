import { type FailedSend, type FlueConversationMessage, useFlueAgent } from "@flue/react"
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react"
import { Avatar, Message } from "../design/index.ts"
import { type FileRow, api } from "../lib/api.ts"
import { splitAttachments } from "../lib/attachments.ts"
import { isTextFile } from "../lib/files.ts"
import { fileSize } from "../lib/format.ts"
import { messageTime } from "../lib/thread.ts"
import { FileViewButton } from "./FileViewer.tsx"
import { Markdown } from "./Markdown.tsx"
import { Summary } from "./Summary.tsx"

/**
 * The scrolling transcript for one Flue conversation: paginated history, the
 * live stream (thinking, tool calls, replies), a working indicator, and any
 * send or turn errors. Ported from the prototype's `Transcript` so the chat
 * screen and the job Activity panel render an agent's work identically. Holds
 * its own scroll and pagination state, so key it by session upstream to reset
 * cleanly on a switch.
 *
 * Trimmed against v2's current API: no compaction cards, no artifact/file cards
 * under a turn yet — those return once the files store has UI. Everything the
 * transcript needs is already in `useFlueAgent`'s message parts.
 */

// Flue's marker for "the system prompt changed at this point", emitted when a
// note is written, the operator profile is edited, or a member's row changes.
const INSTRUCTIONS_UPDATED = "System instructions updated."
// How much of a tool's input fits on one activity line before it stops being a
// summary. A bash command gets the whole line to itself instead.
const TOOL_INPUT_PREVIEW = 120
const INITIAL_MESSAGE_COUNT = 10
const MESSAGE_PAGE_SIZE = 20
const BOTTOM_THRESHOLD = 48

const TRANSCRIPT_CLASS =
  "flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto px-[clamp(16px,3.5vw,36px)] pt-[clamp(20px,3.5vw,30px)] pb-2.5"

type TurnActivityPart = Extract<
  FlueConversationMessage["parts"][number],
  { type: "reasoning" } | { type: "dynamic-tool" }
>

type ToolCallPart = Extract<TurnActivityPart, { type: "dynamic-tool" }>

export function Transcript({
  conversation,
  agent,
  agentInitials,
  files = [],
  containerClassName = TRANSCRIPT_CLASS,
}: {
  conversation: ReturnType<typeof useFlueAgent>
  agent: string
  agentInitials: string
  /** The agent's files, to resolve a user message's attachment ids to chips. */
  files?: FileRow[]
  containerClassName?: string
}) {
  const working = conversation.status === "submitted" || conversation.status === "streaming"
  // Over a real network the history snapshot takes a moment; until it lands, an
  // empty transcript means "still loading", not "no messages". historyReady
  // flips true when the snapshot arrives or the conversation is confirmed
  // absent — status alone stays "idle" through the whole initial fetch.
  const loadingHistory = !conversation.historyReady && conversation.messages.length === 0
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGE_COUNT)
  const transcript = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const initialScroll = useRef(true)
  const scrollFrame = useRef<number | undefined>(undefined)
  // Retrieved archive context is durable model input, but not operator-facing
  // chat. Keep other system messages (notably job activity) visible.
  const messages = conversation.messages.filter(
    (message) => message.signal?.tagName !== "memory-context",
  )
  const visibleMessages = messages.slice(-visibleCount)
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessages.length)
  // Show the dots only until the agent's own turn appears — once it streams, its
  // bubble carries the avatar and its own activity, so a second one would stack.
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  const awaitingFirstReply = !lastMessage || lastMessage.role === "user"
  // Everything after the last operator message is the turn(s) the agent is
  // working on right now. While it works, none of those show their foot
  // timestamp yet — the time lands only once the whole turn settles, so an
  // intermediate step can't stamp "Sunday, 11:00 PM" mid-run.
  const lastUserIndex = visibleMessages.reduce(
    (last, message, index) => (message.role === "user" ? index : last),
    -1,
  )

  // Streaming can update many times per second. Measuring scrollHeight and
  // writing scrollTop in the render-critical layout effect on each delta makes
  // the window stutter, so coalesce it to at most one scroll per frame.
  useEffect(() => {
    const element = transcript.current
    if (!element || (!initialScroll.current && !stickToBottom.current)) return
    scrollFrame.current = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
      initialScroll.current = false
      scrollFrame.current = undefined
    })
    return () => {
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
    }
  })

  function updateScrollPosition() {
    const element = transcript.current
    if (!element) return
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD
  }

  function loadMore() {
    stickToBottom.current = false
    setVisibleCount((count) => count + MESSAGE_PAGE_SIZE)
  }

  return (
    <div ref={transcript} onScroll={updateScrollPosition} className={containerClassName}>
      {loadingHistory && (
        <div className="text-secondary text-ink-muted" aria-live="polite">
          Loading the conversation…
        </div>
      )}
      {conversation.historyReady && messages.length === 0 && (
        <div className="text-secondary text-ink-muted">Say something to start.</div>
      )}
      {hiddenMessageCount > 0 && (
        <button
          className="self-center rounded-control border-0 bg-transparent py-1 text-meta text-ink-muted hover:text-ink-primary"
          onClick={loadMore}
          type="button"
        >
          Load more ({Math.min(MESSAGE_PAGE_SIZE, hiddenMessageCount)} more message
          {hiddenMessageCount === 1 ? "" : "s"})
        </button>
      )}
      {visibleMessages.map((message, index) => (
        <Fragment key={message.id}>
          <Bubble
            message={message}
            agent={agent}
            agentInitials={agentInitials}
            files={files}
            time={messageTime(visibleMessages, index)}
            streaming={working && index === visibleMessages.length - 1}
            settled={!(working && index > lastUserIndex)}
          />
        </Fragment>
      ))}
      {working && awaitingFirstReply && <WorkingIndicator agent={agent} initials={agentInitials} />}
      {/* A send that never reached the server keeps its optimistic bubble above;
          this says it failed and offers to send it again. */}
      {conversation.failedSends.map((failed) => (
        <FailedSendNotice
          key={failed.id}
          failed={failed}
          onRetry={() => conversation.sendMessage(failed.message)}
        />
      ))}
      {/* A turn that crashed after the server accepted it (a model or tool error
          mid-run) leaves no message — surface it or it vanishes. */}
      {conversation.failedSends.length === 0 &&
        conversation.status === "error" &&
        conversation.error && <ChatError error={conversation.error} />}
    </div>
  )
}

function Bubble({
  message,
  agent,
  agentInitials,
  files,
  time,
  streaming,
  settled,
}: {
  message: FlueConversationMessage
  agent: string
  agentInitials: string
  files: FileRow[]
  time: string | undefined
  streaming: boolean
  /** False while the agent is still working this turn — hold its foot timestamp. */
  settled: boolean
}) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim()

  // Job activity arrives as dispatched system messages — muted, distinct.
  if (message.role === "system") {
    if (!text) return null

    // Flue marks the moment an agent's system prompt changed. It is a marker,
    // not work, so it should not look like a returning job.
    if (text === INSTRUCTIONS_UPDATED) {
      return (
        <div
          className="flex items-center gap-3 py-0.5 text-meta text-ink-muted"
          title="This agent's system prompt changed here"
        >
          <span className="h-px flex-1 bg-line-subtle" />
          instructions updated
          <span className="h-px flex-1 bg-line-subtle" />
        </div>
      )
    }

    return (
      <div className="system-card flex max-w-[85%] items-start gap-2 self-start rounded-card border border-line-inset bg-surface-panel px-4 py-3 text-secondary text-ink-secondary">
        <i className="ti ti-clipboard-check mt-0.5 text-[15px]" />
        {/* A closing summary comes back here in full, and they run to
            paragraphs — collapsed to its first line, expandable. */}
        <div className="min-w-0 flex-1">
          <Summary text={text} />
        </div>
      </div>
    )
  }

  if (message.role === "user") {
    // Attachments ride in the body as a reference block; show the text the
    // operator typed plus chips, not the raw block.
    const { text: visible, ids } = splitAttachments(text)
    if (!visible && ids.length === 0) return null
    return (
      <Message from="operator" time={time}>
        {visible && (
          <div className="markdown">
            <Markdown>{visible}</Markdown>
          </div>
        )}
        {ids.length > 0 && <UserAttachments ids={ids} files={files} />}
      </Message>
    )
  }

  return (
    <Message from="agent" initials={agentInitials}>
      <TurnProcessing parts={message.parts} agent={agent} streaming={streaming} />
      {text && (
        <div className="markdown">
          {streaming ? (
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
          ) : (
            <Markdown>{text}</Markdown>
          )}
        </div>
      )}
      <TurnUsage
        metadata={message.metadata}
        time={time}
        streaming={streaming}
        settled={settled}
        copyText={text || undefined}
      />
    </Message>
  )
}

/** The attachment chips under an operator message, matched to the store by id. */
function UserAttachments({ ids, files }: { ids: string[]; files: FileRow[] }) {
  const matched = ids
    .map((id) => files.find((file) => file.id === id))
    .filter((file): file is FileRow => file !== undefined)
  if (matched.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {matched.map((file) => (
        <div
          key={file.id}
          className="flex max-w-[280px] items-center gap-1 rounded-chip border border-line-default bg-surface-inset py-0.5 pr-1 pl-2"
        >
          <a
            href={api.files.contentUrl(file.id)}
            className="flex min-w-0 items-center gap-2 py-0.5 no-underline"
            title={`Download ${file.name}`}
          >
            <i className="ti ti-paperclip shrink-0 text-[13px] text-ink-faint" />
            <span className="min-w-0 truncate text-meta text-ink-secondary">{file.name}</span>
            <span className="shrink-0 font-mono text-mono text-ink-label">
              {fileSize(file.size)}
            </span>
          </a>
          {isTextFile(file) && (
            <FileViewButton
              file={file}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-control border-0 bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
            />
          )}
        </div>
      ))}
    </div>
  )
}

/** Reasoning and tool activity for one turn, collapsed behind a one-line summary. */
function TurnProcessing({
  parts,
  agent,
  streaming,
}: {
  parts: FlueConversationMessage["parts"]
  agent: string
  streaming: boolean
}) {
  const activity = parts.filter(
    (part): part is TurnActivityPart =>
      (part.type === "reasoning" && part.text.trim().length > 0) || part.type === "dynamic-tool",
  )
  if (activity.length === 0) return null
  const thinkingCount = activity.filter((part) => part.type === "reasoning").length
  const toolCount = activity.filter((part) => part.type === "dynamic-tool").length
  const summary = [
    thinkingCount > 0 && `${thinkingCount} message${thinkingCount === 1 ? "" : "s"}`,
    toolCount > 0 && `${toolCount} tool call${toolCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <details className="turn-processing">
      <summary>{summary}</summary>
      <div className="turn-processing-body">
        {activity.map((part, index) => {
          if (part.type === "reasoning") {
            return (
              <div className="thinking-block" key={`thinking-${index}`}>
                {/* Same rule as the reply: don't parse markdown mid-stream. A
                    reasoning block grows token by token, so re-parsing it each
                    delta is the O(n²) cost the memo can't skip. Plain until the
                    turn settles, then rendered as markdown. */}
                {streaming ? (
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{part.text}</div>
                ) : (
                  <Markdown>{part.text}</Markdown>
                )}
              </div>
            )
          }
          return <ToolCall agent={agent} part={part} key={part.toolCallId} />
        })}
      </div>
    </details>
  )
}

/**
 * One tool call. Collapsed it is the same one-line summary as before — name and
 * a bounded preview of the input. A settled call (it has output or an error) is
 * a `<details>`, so a click opens the full untruncated input and the tool's
 * output; the transcript's whole point is that this detail stays out of the way
 * until asked for. A still-running call has nothing to expand yet, so it stays a
 * plain line.
 */
function ToolCall({ agent, part }: { agent: string; part: ToolCallPart }) {
  const status =
    part.state === "output-error" ? " failed" : part.state === "input-available" ? " running" : ""
  const icon = part.toolName === "ask_agent" ? "ti-hierarchy-2" : "ti-tool"
  const head = (
    <>
      <i className={`ti ${icon}`} /> {toolActivityLabel(agent, part.toolName, part.input)}
      {part.state === "input-available" ? "…" : ""}
      {part.state === "output-error" && ` — ${part.errorText}`}
      {part.durationMs !== undefined && ` (${part.durationMs}ms)`}
    </>
  )

  // Nothing settled to reveal yet — keep it a plain, non-interactive line.
  if (part.state === "input-available") {
    return <div className={`tool-activity${status}`}>{head}</div>
  }

  const input = formatToolValue(part.input)
  const output = part.state === "output-available" ? formatToolValue(part.output) : undefined
  return (
    <details className={`tool-activity tool-call${status}`}>
      <summary>{head}</summary>
      <div className="tool-call-detail">
        {input && <ToolCallSection label="Input" body={input} />}
        {part.state === "output-error" && <ToolCallSection label="Error" body={part.errorText} />}
        {output && <ToolCallSection label="Output" body={output} />}
      </div>
    </details>
  )
}

function ToolCallSection({ label, body }: { label: string; body: string }) {
  return (
    <div className="tool-call-section">
      <div className="tool-call-section-label">{label}</div>
      <pre className="tool-call-section-body">{body}</pre>
    </div>
  )
}

/** A tool's input or output for the expanded view: strings verbatim, else JSON. */
function formatToolValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolActivityLabel(agent: string, toolName: string, input: unknown): ReactNode {
  // Asking another agent reads as an act, not a tool use: show the question.
  if (toolName === "ask_agent" && isAskAgentInput(input)) {
    const prompt =
      input.message.length > TOOL_INPUT_PREVIEW
        ? `${input.message.slice(0, TOOL_INPUT_PREVIEW)}…`
        : input.message
    return (
      <>
        {agent} asked {input.agent}:{" "}
        <span className="font-mono text-mono text-ink-secondary">{prompt}</span>
      </>
    )
  }
  // A shell command is the whole content of the call: "used bash" says nothing
  // about what was run.
  if (toolName === "bash" && isBashInput(input)) {
    return (
      <>
        {agent} ran <span className="font-mono text-mono text-ink-secondary">{input.command}</span>
      </>
    )
  }

  const detail = describeToolInput(input)
  return (
    <>
      {agent} used <span className="font-mono text-mono text-ink-secondary">{toolName}</span>
      {detail && <span className="font-mono text-mono text-ink-secondary"> {detail}</span>}
    </>
  )
}

function isAskAgentInput(value: unknown): value is { agent: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "agent" in value &&
    "message" in value &&
    typeof (value as { agent: unknown }).agent === "string" &&
    typeof (value as { message: unknown }).message === "string"
  )
}

function isBashInput(value: unknown): value is { command: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    typeof (value as { command: unknown }).command === "string"
  )
}

/**
 * A one-line summary of what a tool was asked for. Bounded, because a tool
 * input can be a whole SQL query and this sits inside an activity line.
 */
function describeToolInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const parts = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
  if (parts.length === 0) return ""

  const text = parts.join(" ").replace(/\s+/g, " ")
  return text.length > TOOL_INPUT_PREVIEW ? `${text.slice(0, TOOL_INPUT_PREVIEW)}…` : text
}

/** Time and, expandably, token/cost usage at the foot of an agent turn. */
function TurnUsage({
  metadata,
  time,
  streaming = false,
  settled = true,
  copyText,
}: {
  metadata: FlueConversationMessage["metadata"]
  time?: string
  streaming?: boolean
  /** False while the agent still works this turn — hold the time/cost line back. */
  settled?: boolean
  copyText?: string
}) {
  // The streaming turn (the last one) shows the working dots at its foot, so
  // "working" stays visible the whole time the agent runs (not just before its
  // bubble appears). An earlier step of the same in-flight turn shows nothing
  // yet — its dots are carried by the last turn's foot, one indicator, not one
  // per step. Either way the time and cost land only once the turn settles, so
  // no step stamps "Sunday, 11:00 PM" mid-run.
  if (streaming) return <WorkingDots />
  if (!settled) return null
  const usage = metadata?.usage
  const clock = time ? <Clock at={time} /> : null
  const copy = copyText ? <CopyTurn text={copyText} /> : null
  const durationMs = turnDurationMs(metadata)
  const duration = durationMs !== undefined ? formatDuration(durationMs) : null
  const lead = clock || copy
  if (!isUsage(usage)) {
    if (!lead && !duration) return null
    return (
      <div className="turn-usage">
        {clock}
        {copy}
        {lead && duration && " · "}
        {duration}
      </div>
    )
  }
  // Output tokens per wall-clock second — the generation rate, not counting the
  // input already in the prompt.
  const rate = durationMs && durationMs > 0 ? usage.output / (durationMs / 1000) : undefined
  return (
    <details className="turn-usage">
      <summary>
        {clock}
        {copy}
        {lead && " · "}
        {duration && `${duration} · `}${formatCost(usage.cost.total)} ·{" "}
        {usage.totalTokens.toLocaleString()} tokens
        {rate !== undefined && ` · ${formatRate(rate)} tok/s`}
      </summary>
      <span>
        Input {usage.input.toLocaleString()} · Cache read {usage.cacheRead.toLocaleString()} · Cache
        write {usage.cacheWrite.toLocaleString()} · Output {usage.output.toLocaleString()}
      </span>
    </details>
  )
}

/** Milliseconds between a turn's startedAt and finishedAt stamps, when both landed. */
function turnDurationMs(metadata: FlueConversationMessage["metadata"]): number | undefined {
  const started = metadataTimestamp(metadata, "startedAt")
  const finished = metadataTimestamp(metadata, "finishedAt")
  if (started === undefined || finished === undefined || finished < started) return undefined
  return finished - started
}

function metadataTimestamp(
  metadata: FlueConversationMessage["metadata"],
  key: string,
): number | undefined {
  const value = (metadata as Record<string, unknown> | undefined)?.[key]
  if (typeof value !== "string") return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/** "5m 15s", "15s", or "1h 2m 3s" — drops the units that are zero from the left. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

/** A generation rate reads better with a decimal when slow, whole when fast. */
function formatRate(rate: number): string {
  return rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1)
}

/**
 * Copy an agent turn's text as markdown. It sits inside the usage line's
 * <summary>, so the click must not toggle that disclosure — hence the
 * preventDefault/stopPropagation. Flips to a check for a moment as feedback.
 */
function CopyTurn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="turn-copy"
      title="Copy as Markdown"
      aria-label="Copy as Markdown"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      <i className={copied ? "ti ti-check" : "ti ti-copy"} />
    </button>
  )
}

function Clock({ at }: { at: string }) {
  const moment = new Date(at)
  if (Number.isNaN(moment.getTime())) return null
  return (
    <time dateTime={at} title={moment.toLocaleString()}>
      {formatTurnTime(moment)}
    </time>
  )
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Within the last week a turn reads by its weekday ("Monday, 8:34 PM"); older
 * than that it needs the calendar date ("September 4th, 8:34 PM"). The time
 * itself is locale-formatted, so it lands as 12- or 24-hour to match the
 * viewer; only the "4th" ordinal is English.
 */
function formatTurnTime(moment: Date): string {
  const time = moment.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const age = Date.now() - moment.getTime()
  if (age >= 0 && age < WEEK_MS) {
    return `${moment.toLocaleDateString([], { weekday: "long" })}, ${time}`
  }
  const month = moment.toLocaleDateString([], { month: "long" })
  return `${month} ${ordinal(moment.getDate())}, ${time}`
}

function ordinal(day: number): string {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function isUsage(value: unknown): value is {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: { total: number }
} {
  if (value === null || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.totalTokens !== "number" ||
    typeof candidate.input !== "number" ||
    typeof candidate.output !== "number" ||
    typeof candidate.cacheRead !== "number" ||
    typeof candidate.cacheWrite !== "number" ||
    candidate.cost === null
  )
    return false
  if (typeof candidate.cost !== "object") return false
  return typeof (candidate.cost as Record<string, unknown>).total === "number"
}

function formatCost(cost: number): string {
  // Two decimals by default ($0.00); a sub-cent turn that would round to $0.00
  // gets a third decimal so it doesn't read as free.
  return cost > 0 && cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)
}

/** A turn that failed after the server took it — the message vanishes, so say why. */
function ChatError({ error }: { error: Error }) {
  return (
    <div className="chat-error" role="alert">
      <i className="ti ti-alert-triangle" />
      <div style={{ minWidth: 0 }}>
        <div className="chat-error-title">The agent hit an error</div>
        <div className="chat-error-detail">{errorText(error)}</div>
      </div>
    </div>
  )
}

/** A send that failed before the server accepted it, with a way to send it again. */
function FailedSendNotice({ failed, onRetry }: { failed: FailedSend; onRetry: () => void }) {
  return (
    <div className="chat-error" role="alert">
      <i className="ti ti-alert-triangle" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="chat-error-title">Message not sent</div>
        <div className="chat-error-detail">{errorText(failed.error)}</div>
      </div>
      <button type="button" className="chat-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

// Flue wraps a model or tool failure as "direct(sub_…) failed: <reason>". Show
// the reason, which is the part a person can act on ("… exceeds the context
// window …"), not the internal operation id.
export function errorText(error: Error): string {
  const match = /failed:\s*(.*)$/s.exec(error.message)
  return (match?.[1] ?? error.message).trim() || "Something went wrong."
}

function WorkingIndicator({ agent, initials }: { agent: string; initials: string }) {
  return (
    <div className="flex items-center gap-3.5" aria-label={`${agent} is working`}>
      <Avatar initials={initials} size="md" />
      <WorkingDots />
    </div>
  )
}

/** The three animated dots. Stands alone before the turn's bubble appears, then
    at the foot of the turn (via TurnUsage) for as long as it streams. */
function WorkingDots() {
  return (
    <div className="agent-working" role="status" aria-label="Working">
      <span />
      <span />
      <span />
    </div>
  )
}
