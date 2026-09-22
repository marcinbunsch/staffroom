import { randomUUID } from "node:crypto"
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client"
import type { McpDiscoveredTool, McpTransport, Toolset } from "@staffroom/protocol"
import { getSandboxEnvironment } from "./docker-sandbox.ts"

/**
 * The thin MCP client layer: connect to a server with a bearer token, list its
 * tools, inspect one's schema, and call one. Every operation connects, does its
 * work, and closes — stateless, one round trip. It is the prototype's gateway
 * connection code, with the token supplied by the caller (resolved per user
 * from the named integration) rather than read from a single-user store.
 */

/** How the transport is told, and where the bearer comes from. */
export interface McpTarget {
  url: string
  transport: McpTransport
}

// Bytes of tool output above which the result is truncated rather than returned
// whole. ~8 KB ≈ 2k tokens: quick answers stay inline, a log dump gets capped.
const SPILL_BYTES = Number(process.env.STAFFROOM_MCP_SPILL_BYTES ?? "8192")

/** Discover a server's tools — name and one-line description — for the config screen. */
export async function discoverMcpTools(
  target: McpTarget,
  bearer: string,
): Promise<McpDiscoveredTool[]> {
  const client = await connect(target, bearer)
  try {
    const { tools } = await client.listTools()
    return tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" }))
  } finally {
    await client.close()
  }
}

/** The full schema of one tool, fetched live — for describe_tool. */
export async function describeMcpTool(
  target: McpTarget,
  tool: string,
  bearer: string,
): Promise<{ name: string; description: string; inputSchema: unknown }> {
  const client = await connect(target, bearer)
  try {
    const found = (await client.listTools()).tools.find((candidate) => candidate.name === tool)
    if (!found) throw new Error(`This MCP server no longer exposes "${tool}".`)
    return {
      name: found.name,
      description: found.description ?? "",
      inputSchema: found.inputSchema,
    }
  } finally {
    await client.close()
  }
}

/**
 * Call one tool and return its text result. A very large result spills to a
 * file in the caller's sandbox (`/work/mcp`) with a short pointer + preview, so
 * a log dump never floods the context; with no sandbox it is truncated instead.
 */
export async function callMcpTool(
  target: McpTarget,
  tool: string,
  args: Record<string, unknown>,
  bearer: string,
  session: string,
  signal?: AbortSignal,
): Promise<string> {
  const client = await connect(target, bearer)
  try {
    const result = await client.callTool({ name: tool, arguments: args }, { signal })
    const text = (result.content ?? [])
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n\n")
    if (result.isError) throw new Error(text || "The MCP tool reported an error.")
    return presentResult(text || JSON.stringify(result.structuredContent ?? result), tool, session)
  } finally {
    await client.close()
  }
}

const PREVIEW_LINES = 20
const PREVIEW_BYTES = 1000

/**
 * Keep a very large result out of the model's context. Small output returns
 * unchanged. A big result is written to `/work/mcp` in the caller's sandbox and
 * replaced with a pointer the agent narrows with its shell tools; with no
 * sandbox (or a write failure) it is truncated with a note instead.
 */
async function presentResult(text: string, tool: string, session: string): Promise<string> {
  const bytes = Buffer.byteLength(text)
  if (bytes <= SPILL_BYTES) return text

  const env = getSandboxEnvironment(session)
  if (!env)
    return truncated(text, bytes, "Grant this agent a sandbox to work with the full result.")

  const path = `/work/mcp/${spillFileName(tool, text)}`
  try {
    await env.writeFile(path, text)
  } catch (error) {
    return truncated(text, bytes, `writing to the sandbox failed: ${(error as Error).message}`)
  }
  const lines = text.split("\n").length
  const preview = text.split("\n").slice(0, PREVIEW_LINES).join("\n").slice(0, PREVIEW_BYTES)
  return (
    `[Large result: ${bytes} bytes, ${lines} lines, written to ${path}.\n` +
    "Narrow it with your shell tools (rg, jq, python3) on that file — do not re-run this call.]\n\n" +
    `Preview (first ${PREVIEW_LINES} lines):\n${preview}`
  )
}

function truncated(text: string, bytes: number, reason: string): string {
  return `${text.slice(0, SPILL_BYTES)}\n\n[truncated: showing ${SPILL_BYTES} of ${bytes} bytes. ${reason}]`
}

function spillFileName(tool: string, text: string): string {
  const safe = tool.replace(/[^a-zA-Z0-9_.-]/g, "-")
  const extension = isJson(text) ? "json" : "txt"
  return `${safe}-${randomUUID().slice(0, 8)}.${extension}`
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

async function connect(target: McpTarget, bearer: string): Promise<Client> {
  const client = new Client({ name: "staffroom", version: "0.0.0" })
  const url = new URL(target.url)
  const authProvider = { token: async () => bearer }
  const transport =
    target.transport === "sse"
      ? new SSEClientTransport(url, { authProvider })
      : new StreamableHTTPClientTransport(url, { authProvider })
  await client.connect(transport)
  return client
}

/** A registered server's connection target. */
export function targetOf(server: Toolset): McpTarget {
  return { url: server.url ?? "", transport: server.transport ?? "streamable-http" }
}

/**
 * Whether an error is the transport's "the server rejected our token" signal —
 * a 401 the SDK surfaces as `UnauthorizedError` (after its one retry). This is
 * specifically an authentication failure: a 403, a rate limit, or a tool-level
 * error come back as other error types, so a caller can safely treat this as
 * "the stored credential is no longer valid" without catching transient faults.
 */
export function isMcpAuthError(error: unknown): boolean {
  return UnauthorizedError.isInstance(error)
}
