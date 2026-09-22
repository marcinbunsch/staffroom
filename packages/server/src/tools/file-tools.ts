import { defineTool, useInstruction, useTool } from "@flue/runtime"
import { basename } from "node:path"
import * as v from "valibot"
import { getFilesStore } from "../coordinator/files.ts"
import { getSandboxEnvironment } from "./docker-sandbox.ts"

/**
 * The file tools an agent gets. An agent produces and reads files; it cannot
 * promote one to the organization — that is a human's call (see files.ts), so
 * there is deliberately no `share` tool here.
 */
export interface FileToolContext {
  tenantId: string
  agent: string
  /** The owning session — also the key for its live Docker sandbox. */
  session: string
  jobId?: number
}

export function attachFileTools(context: FileToolContext): void {
  useInstruction(
    "## Artifacts\n\nAn artifact is a durable Staffroom file that is the result of your work. Save reports, generated documents, data extracts, and other deliverables with `save_artifact`; if you created the result in the sandbox, use `create_artifact_from_sandbox`. Do not merely mention a sandbox path when the user needs the result.\n\nTo point the reader at an artifact, use a Markdown link to its viewer at `/print/<id>`, where `<id>` is the artifact id — e.g. `[Weekly report](/print/6f9b…)`. That page renders the file full-screen with its charts drawn and a Save-as-PDF button. Use that exact path with the real id; never invent other links (no `sandbox:`, `file:`, `artifact:`, raw file names, or download URLs) — they do not resolve.",
  )
  useTool(makeSaveArtifact(context))
  useTool(makeReadFile(context))
  useTool(makeListFiles(context))
  useTool(makeLabelFile(context))
  useTool(makeCreateArtifactFromSandbox(context))
  useTool(makeSaveFileToSandbox(context))
}

function makeSaveArtifact(context: FileToolContext) {
  return defineTool({
    name: "save_artifact",
    description:
      "Save a text artifact: a durable Staffroom file that is the result of your work, such as a report, generated document, or data extract. Use this instead of dumping large content into a reply or summary; the artifact can be handed on by reference.",
    input: v.object({
      name: v.pipe(v.string(), v.minLength(1), v.description("A short file-like name")),
      content: v.pipe(v.string(), v.minLength(1), v.description("The full text content")),
      contentType: v.optional(v.string()),
      labels: v.optional(
        v.pipe(
          v.array(v.string()),
          v.description(
            "A few short, reusable topics for browsing and retrieval, e.g. ['invoices', 'onboarding']. Use lowercase words shared across related files. Do not use one-off identifiers (job, room, or session ids), dates, or generated strings — Staffroom already tracks those.",
          ),
        ),
      ),
    }),
    run: async ({ data }) => {
      const file = getFilesStore().create(
        context.tenantId,
        {
          name: data.name,
          contentType: data.contentType ?? "text/plain",
          source: "agent",
          agent: context.agent,
          jobId: context.jobId ?? null,
          messageId: null,
          labels: data.labels ?? [],
        },
        data.content,
      )
      return `Saved artifact "${file.name}" (${file.id}, ${file.size} bytes). To show it to the reader, link to it as [${file.name}](/print/${file.id}); the content is stored out of the way.`
    },
  })
}

function makeReadFile(context: FileToolContext) {
  return defineTool({
    name: "read_file",
    description: "Read a file by id — your own, or one the organization has shared.",
    input: v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
    run: async ({ data }) => {
      const bytes = await getFilesStore().bytes(context.tenantId, data.id)
      if (!bytes) return `File "${data.id}" not found.`
      return bytes.toString("utf8")
    },
  })
}

function makeListFiles(context: FileToolContext) {
  return defineTool({
    name: "list_files",
    description:
      'List files you can read — your own, plus any the organization has shared. Narrow to a topic with `label`, or to recent files with `since` — so "new files about X" is one call.',
    input: v.object({
      label: v.optional(v.pipe(v.string(), v.description("Only files tagged with this topic"))),
      since: v.optional(
        v.pipe(v.string(), v.description("Only files created at or after this ISO timestamp")),
      ),
    }),
    run: async ({ data }) => {
      const files = getFilesStore().list(context.tenantId, { label: data.label, since: data.since })
      if (files.length === 0) return "No files."
      return files
        .map((file) => {
          const shared = file.visibility === "org" ? ", shared" : ""
          const labels = file.labels.length > 0 ? ` [${file.labels.join(", ")}]` : ""
          return `- ${file.name} (${file.id}, ${file.size} bytes${shared})${labels}`
        })
        .join("\n")
    },
  })
}

function makeLabelFile(context: FileToolContext) {
  return defineTool({
    name: "label_file",
    description:
      "Set the topics on a file you own, for later retrieval by `list_files`. Replaces the file's labels; pass the full set each time.",
    input: v.object({
      id: v.pipe(v.string(), v.minLength(1)),
      labels: v.pipe(
        v.array(v.string()),
        v.description(
          "The full set of topics for the file — short, reusable, lowercase words shared across related files, not one-off identifiers or dates.",
        ),
      ),
    }),
    run: async ({ data }) => {
      const file = getFilesStore().setLabels(context.tenantId, data.id, data.labels)
      if (!file) return `File "${data.id}" not found, or you do not own it.`
      return file.labels.length > 0
        ? `Labelled "${file.name}": ${file.labels.join(", ")}.`
        : `Cleared the labels on "${file.name}".`
    },
  })
}

/** Copy a finished sandbox file into Staffroom as an agent-produced artifact. */
function makeCreateArtifactFromSandbox(context: FileToolContext) {
  return defineTool({
    name: "create_artifact_from_sandbox",
    description:
      "Create a durable Staffroom artifact from a file in your sandbox. Use this to deliver a report, image, archive, or other output you created under /work; it is not enough to merely mention a sandbox path.",
    input: v.object({
      path: v.pipe(v.string(), v.minLength(1), v.description("Path to the sandbox file to save")),
      name: v.optional(
        v.pipe(v.string(), v.minLength(1), v.description("File name to show in Staffroom")),
      ),
      contentType: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
    }),
    run: async ({ data }) => {
      const sandbox = getSandboxEnvironment(context.session)
      if (!sandbox) return noSandbox()
      try {
        const stat = await sandbox.stat(data.path)
        if (!stat.isFile) return `"${data.path}" is not a file in the sandbox.`
        const bytes = Buffer.from(await sandbox.readFileBuffer(data.path))
        const name = data.name ?? basename(data.path)
        if (!name) return `Could not determine a file name for "${data.path}".`
        const file = getFilesStore().create(
          context.tenantId,
          {
            name,
            contentType: data.contentType ?? "application/octet-stream",
            source: "agent",
            agent: context.agent,
            jobId: context.jobId ?? null,
            messageId: null,
            labels: data.labels ?? [],
          },
          bytes,
        )
        return `Created artifact "${file.name}" (${file.id}, ${file.size} bytes) from ${data.path}. To show it to the reader, link to it as [${file.name}](/print/${file.id}).`
      } catch (error) {
        return `Could not save "${data.path}" from the sandbox: ${message(error)}`
      }
    },
  })
}

/** Materialize a durable Staffroom file into the caller's sandbox workspace. */
function makeSaveFileToSandbox(context: FileToolContext) {
  return defineTool({
    name: "save_file_to_sandbox",
    description:
      "Copy a readable Staffroom file into your sandbox. Use this before processing, converting, or inspecting a file with sandbox tools.",
    input: v.object({
      id: v.pipe(v.string(), v.minLength(1), v.description("The Staffroom file id")),
      path: v.pipe(v.string(), v.minLength(1), v.description("Destination path in the sandbox")),
    }),
    run: async ({ data }) => {
      const sandbox = getSandboxEnvironment(context.session)
      if (!sandbox) return noSandbox()
      const bytes = await getFilesStore().bytes(context.tenantId, data.id)
      if (!bytes) return `File "${data.id}" not found.`
      try {
        await sandbox.writeFile(data.path, bytes)
        return `Saved file "${data.id}" to ${data.path} (${bytes.length} bytes).`
      } catch (error) {
        return `Could not save file "${data.id}" to the sandbox: ${message(error)}`
      }
    },
  })
}

function noSandbox(): string {
  return "No sandbox is attached to this session. Ask the operator to grant this agent a Docker Sandbox toolset."
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
