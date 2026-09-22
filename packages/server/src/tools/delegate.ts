import { defineTool, useTool } from "@flue/runtime"
import * as v from "valibot"

// A child that returns nothing usable still has to say so, rather than handing
// the parent an empty string it cannot tell apart from a failure.
const EMPTY_RESULT = "(the delegated task returned no text)"

/**
 * `delegate` — a built-in. Hand a focused task to a child agent that runs in
 * its own fresh context, with the caller's full toolset and sharing its live
 * environment (Flue's `harness.prompt` seeds the child with `[...parentTools]`
 * and the sandbox), so the child can do real work over `/work` — but it sees
 * none of the caller's conversation. Only its final answer comes back.
 *
 * That is the point: the child reads and chews through a lot of data in its own
 * context, and the caller's context only ever holds the short result. The model
 * can call `delegate` several times in one turn (Flue runs a tool batch in
 * parallel) for map-reduce over the shared `/work`. A child inherits the
 * caller's tools, so nesting is possible; Flue caps delegation depth (4).
 */
const delegate = defineTool({
  name: "delegate",
  description:
    "Delegate a focused task to a child agent that runs in its own fresh context, with your full toolset and sharing your sandbox filesystem. Use it to work through a lot of data without filling your own context, or to fan several tasks out at once — call delegate multiple times in one turn and they run in parallel, each over the shared /work directory, then combine their results yourself. The child sees none of this conversation, so put complete, self-contained instructions in `prompt`. It returns only its final answer: for anything large, have the child write a file to the sandbox or save it and return the path, not the data itself.",
  input: v.object({
    prompt: v.pipe(
      v.string(),
      v.minLength(1, "Give the child agent complete, self-contained instructions."),
    ),
  }),
  harness: true,
  run: async ({ data, harness }) => {
    const { text } = await harness.prompt(data.prompt)
    return text.trim() || EMPTY_RESULT
  },
})

export function attachDelegateTool(): void {
  useTool(delegate)
}
