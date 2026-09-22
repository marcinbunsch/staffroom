import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { type SandboxDriver, type SandboxFactory, sandboxFromDriver } from "@flue/runtime"
import type { FileStat, Sandbox, ShellResult } from "@flue/runtime"
import { STAFFROOM_HOME } from "../core/config.ts"

/**
 * The Docker sandbox — a Flue `SandboxDriver` over a per-conversation container.
 *
 * Ported from the prototype, which did this well. The agent never sees custom
 * tools: attaching a sandbox (`useSandbox`) makes Flue add its built-in
 * read/write/edit/bash/grep/glob set. This module only implements the driver
 * (exec + filesystem via `docker exec`), manages one container per conversation
 * id, and mirrors + mounts repositories read-only for reference.
 */

// All env-tunable, like the prototype — no settings row for these.
const IMAGE = process.env.STAFFROOM_SANDBOX_IMAGE ?? "staffroom-sandbox:latest"
const MEMORY = process.env.STAFFROOM_SANDBOX_MEMORY ?? "512m"
const CPUS = process.env.STAFFROOM_SANDBOX_CPUS ?? "1"
// 15 minutes idle, not a hard lifetime: a container is kept alive across a
// conversation's turns and only reaped once it has been quiet this long.
const IDLE_TIMEOUT_MS = Number(process.env.STAFFROOM_SANDBOX_IDLE_SECONDS ?? "900") * 1000
const SWEEP_INTERVAL_MS = 60_000
const EXEC_TIMEOUT_MS = Number(process.env.STAFFROOM_SANDBOX_EXEC_TIMEOUT_MS ?? "120000")
const REPOSITORY_MOUNT_ROOT = "/repos"
const MIRROR_ROOT = join(STAFFROOM_HOME, "repository-mirrors")
// Unlike a container, a workspace is durable: a replacement container mounts
// the same directory after a Docker restart, OOM kill, or manual removal.
const WORKSPACE_ROOT = join(STAFFROOM_HOME, "sandbox-workspaces")

/** One configured repository: a name to mount under, and a local git work tree. */
export interface SandboxRepo {
  name: string
  path: string
}

/** Run `docker` with the given args, buffering output, with an optional timeout/abort. */
function docker(
  args: string[],
  input?: string | Uint8Array,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let timer: NodeJS.Timeout | undefined
    const onAbort = () => child.kill("SIGKILL")
    if (signal) signal.addEventListener("abort", onAbort, { once: true })
    if (timeoutMs) timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", () => resolve({ code: -1, stdout, stderr }))
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener("abort", onAbort)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}

/** Is the Docker daemon up and the sandbox image present? Probed once at boot. */
export async function dockerSandboxAvailable(): Promise<boolean> {
  if (process.env.STAFFROOM_SANDBOX_ENABLED === "0") return false
  try {
    const daemon = await docker(["version", "--format", "{{.Server.Version}}"], undefined, 5_000)
    if (daemon.code !== 0) return false
    return (await docker(["image", "inspect", IMAGE], undefined, 5_000)).code === 0
  } catch {
    return false
  }
}

// The boot-time flag the render path reads synchronously.
let sandboxEnabled = false

export async function initDockerSandbox(): Promise<boolean> {
  sandboxEnabled = await dockerSandboxAvailable()
  if (sandboxEnabled) {
    await removeOrphanedSandboxes()
    startIdleSweep()
  }
  return sandboxEnabled
}

export function dockerSandboxEnabled(): boolean {
  return sandboxEnabled
}

/**
 * Refresh a bare mirror of a repository's origin under the mirror root, and
 * return where it lives. Deliberately fetches the checkout's *upstream* origin,
 * not the local checkout, so every remote branch is present inside the
 * network-isolated container. Never mutates the operator's checkout.
 */
async function refreshMirror(repo: SandboxRepo): Promise<string> {
  await mkdir(MIRROR_ROOT, { recursive: true })
  const key = createHash("sha256").update(`${repo.name}:${repo.path}`).digest("hex").slice(0, 24)
  const mirror = join(MIRROR_ROOT, `${key}.git`)

  const upstream = await git(["-C", repo.path, "remote", "get-url", "origin"])
  const url = upstream.stdout.trim() || repo.path
  const exists = (await git(["-C", mirror, "rev-parse", "--is-bare-repository"])).code === 0
  if (exists) {
    await git(["-C", mirror, "remote", "set-url", "origin", url])
    await git(["-C", mirror, "fetch", "--prune", "origin"])
  } else {
    await git(["clone", "--mirror", url, mirror])
  }
  return mirror
}

/** Run `git` with buffered output. */
function git(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (c) => {
      stdout += c
    })
    child.stderr.on("data", (c) => {
      stderr += c
    })
    child.on("error", () => resolve({ code: -1, stdout, stderr }))
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** The `--mount` args for a set of repos, refreshing each mirror first (read-only). */
async function repositoryMountArgs(repos: SandboxRepo[]): Promise<string[]> {
  const args: string[] = []
  for (const repo of repos) {
    const mirror = await refreshMirror(repo)
    if (mirror.includes(",")) throw new Error("A mirror path may not contain a comma.")
    args.push(
      "--mount",
      `type=bind,src=${mirror},dst=${REPOSITORY_MOUNT_ROOT}/${repo.name}.git,readonly`,
    )
  }
  return args
}

/** The `SandboxDriver` over one recoverable, per-conversation container. */
class DockerSandbox implements SandboxDriver {
  #container = ""
  readonly #id: string
  readonly #repos: SandboxRepo[]
  readonly #workspace: string
  readonly #onActivity: () => void
  #removed = false
  #reprovisioning: Promise<void> | undefined

  constructor(id: string, repos: SandboxRepo[], workspace: string, onActivity: () => void) {
    this.#id = id
    this.#repos = repos
    this.#workspace = workspace
    this.#onActivity = onActivity
  }

  static async start(
    id: string,
    repos: SandboxRepo[],
    onActivity: () => void,
  ): Promise<DockerSandbox> {
    const workspace = workspaceFor(id)
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    const sandbox = new DockerSandbox(id, repos, workspace, onActivity)
    await sandbox.#provision()
    return sandbox
  }

  async #provision(): Promise<void> {
    if (this.#removed) throw new Error("Docker sandbox has been removed.")
    const container = `staffroom-sbx-${this.#id.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40)}-${randomHex()}`
    const mounts = this.#repos.length > 0 ? await repositoryMountArgs(this.#repos) : []
    if (this.#workspace.includes(","))
      throw new Error("A sandbox workspace path may not contain a comma.")
    const run = await docker([
      "run",
      "-d",
      "--rm",
      "--name",
      container,
      "--label",
      "staffroom-sandbox",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:exec",
      "--mount",
      `type=bind,src=${this.#workspace},dst=/work`,
      ...mounts,
      "-w",
      "/work",
      "--memory",
      MEMORY,
      "--cpus",
      CPUS,
      "--pids-limit",
      "256",
      IMAGE,
      "sleep",
      "infinity",
    ])
    if (run.code !== 0) throw new Error(`Docker sandbox failed to start: ${run.stderr.trim()}`)
    if (this.#removed) {
      await docker(["rm", "-f", container])
      throw new Error("Docker sandbox has been removed.")
    }
    this.#container = container
  }

  async remove(): Promise<void> {
    this.#removed = true
    await docker(["rm", "-f", this.#container])
  }

  async #run(
    args: string[],
    input?: string | Uint8Array,
    signal?: AbortSignal,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    this.#onActivity()
    return this.#exec(args, input, EXEC_TIMEOUT_MS, signal)
  }

  /** Run one container command, recreating and retrying once if Docker lost it. */
  async #exec(
    args: string[],
    input: string | Uint8Array | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
    options: string[] = [],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let result = await docker(
      ["exec", "-i", ...options, this.#container, ...args],
      input,
      timeoutMs,
      signal,
    )
    if (!containerUnavailable(result)) return result
    await this.#recover()
    result = await docker(
      ["exec", "-i", ...options, this.#container, ...args],
      input,
      timeoutMs,
      signal,
    )
    return result
  }

  async #recover(): Promise<void> {
    if (this.#removed) throw new Error("Docker sandbox has been removed.")
    this.#reprovisioning ??= (async () => {
      // The container may already be gone. `rm -f` is intentionally best-effort
      // so both an externally removed and a stopped container recover alike.
      await docker(["rm", "-f", this.#container])
      await this.#provision()
    })().finally(() => {
      this.#reprovisioning = undefined
    })
    await this.#reprovisioning
  }

  async exec(
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeoutMs?: number
      signal?: AbortSignal
    },
  ): Promise<ShellResult> {
    this.#onActivity()
    const dockerOptions: string[] = []
    for (const [key, value] of Object.entries(options?.env ?? {}))
      dockerOptions.push("-e", `${key}=${value}`)
    if (options?.cwd) dockerOptions.push("-w", options.cwd)
    const result = await this.#exec(
      ["sh", "-lc", command],
      undefined,
      options?.timeoutMs ?? EXEC_TIMEOUT_MS,
      options?.signal,
      dockerOptions,
    )
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
  }

  async readFile(path: string): Promise<string> {
    const result = await this.#run(["cat", path])
    if (result.code !== 0) throw new Error(`readFile ${path}: ${result.stderr.trim()}`)
    return result.stdout
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    // Docker's stdout is collected as text by `docker()`, so base64 keeps
    // arbitrary bytes intact across the process boundary.
    const result = await this.#run(["base64", path])
    if (result.code !== 0) throw new Error(`readFileBuffer ${path}: ${result.stderr.trim()}`)
    return Buffer.from(result.stdout, "base64")
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf("/")) || "/"
    await this.#run(["mkdir", "-p", dir])
    // See readFileBuffer: sending encoded bytes makes binary artifacts (PDFs,
    // images, archives) safe instead of lossy UTF-8 text.
    const encoded = Buffer.from(content).toString("base64")
    const result = await this.#run(["sh", "-c", 'base64 -d > "$1"', "sh", path], encoded)
    if (result.code !== 0) throw new Error(`writeFile ${path}: ${result.stderr.trim()}`)
  }

  async stat(path: string): Promise<FileStat> {
    const result = await this.#run(["stat", "-c", "%F|%s", path])
    if (result.code !== 0) throw new Error(`stat ${path}: ${result.stderr.trim()}`)
    const [kind, size] = result.stdout.trim().split("|")
    return {
      isFile: kind !== "directory",
      isDirectory: kind === "directory",
      size: Number(size ?? 0),
    }
  }

  async readdir(path: string): Promise<string[]> {
    const result = await this.#run(["ls", "-1A", path])
    if (result.code !== 0) throw new Error(`readdir ${path}: ${result.stderr.trim()}`)
    return result.stdout.split("\n").filter(Boolean)
  }

  async exists(path: string): Promise<boolean> {
    return (await this.#run(["test", "-e", path])).code === 0
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.#run(options?.recursive ? ["mkdir", "-p", path] : ["mkdir", path])
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const flags = `${options?.recursive ? "r" : ""}${options?.force ? "f" : ""}`
    await this.#run(flags ? ["rm", `-${flags}`, path] : ["rm", path])
  }
}

function randomHex(): string {
  return createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8)
}

/** A stable, filesystem-safe workspace name for a session without leaking its id. */
function workspaceFor(id: string): string {
  return join(WORKSPACE_ROOT, createHash("sha256").update(id).digest("hex"))
}

function containerUnavailable(result: { stderr: string }): boolean {
  return result.stderr.includes("No such container:") || result.stderr.includes("is not running")
}

interface PoolEntry {
  sandbox: DockerSandbox
  env: Sandbox
  repoKey: string
  lastUsedAt: number
}

/** One container per conversation id, reused across turns and reaped when idle. */
class SandboxPool {
  readonly #entries = new Map<string, PoolEntry>()

  async ensure(id: string, repos: SandboxRepo[]): Promise<Sandbox> {
    const repoKey = repos
      .map((r) => r.name)
      .sort()
      .join(",")
    const existing = this.#entries.get(id)
    if (existing && existing.repoKey === repoKey) {
      existing.lastUsedAt = Date.now()
      return existing.env
    }
    if (existing) await existing.sandbox.remove()

    const entry: PoolEntry = { repoKey, lastUsedAt: Date.now() } as PoolEntry
    const sandbox = await DockerSandbox.start(id, repos, () => {
      entry.lastUsedAt = Date.now()
    })
    entry.sandbox = sandbox
    entry.env = sandboxFromDriver(sandbox, "/work")
    this.#entries.set(id, entry)
    return entry.env
  }

  get(id: string): Sandbox | undefined {
    const entry = this.#entries.get(id)
    if (!entry) return undefined
    entry.lastUsedAt = Date.now()
    return entry.env
  }

  async reapIdle(now = Date.now()): Promise<void> {
    for (const [id, entry] of this.#entries) {
      if (now - entry.lastUsedAt > IDLE_TIMEOUT_MS) {
        this.#entries.delete(id)
        await entry.sandbox.remove()
      }
    }
  }
}

const pool = new SandboxPool()

/**
 * The `SandboxFactory` for one conversation, mounting the given repos. No
 * `tools()` override, so Flue mounts its default read/write/edit/bash/grep/glob
 * set. The pool keys on the conversation id, so `/work` survives across turns.
 */
export function dockerSandboxFactory(repos: SandboxRepo[]): SandboxFactory {
  return {
    createSandbox: ({ id }: { id: string }) => pool.ensure(id, repos),
  }
}

/** The live sandbox for a session, for the MCP large-result spill. Undefined if none. */
export function getSandboxEnvironment(id: string): Sandbox | undefined {
  return pool.get(id)
}

let sweeping = false
function startIdleSweep(): void {
  if (sweeping) return
  sweeping = true
  setInterval(() => void pool.reapIdle(), SWEEP_INTERVAL_MS).unref()
}

/**
 * Remove containers left behind by a crashed process. `--rm` only fires on a
 * clean stop, so a hard crash leaves `sleep infinity` containers running; clear
 * them by label at boot.
 */
async function removeOrphanedSandboxes(): Promise<void> {
  const listed = await docker(["ps", "-aq", "--filter", "label=staffroom-sandbox"])
  const ids = listed.stdout.split("\n").filter(Boolean)
  if (ids.length > 0) await docker(["rm", "-f", ...ids])
}
