import { createInterface } from "node:readline"

/** Ask a question on the terminal, returning the trimmed answer. */
export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    }),
  )
}

/**
 * Ask for a secret without echoing it. We write the prompt ourselves, then
 * silence readline's own output so the typed key never lands on screen or in a
 * scrollback buffer — the same reason the UI shows a minted key only once.
 */
export function askSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const muted = rl as unknown as { _writeToOutput: (chunk: string) => void }
  process.stdout.write(question)
  muted._writeToOutput = () => {}
  return new Promise((resolve) =>
    rl.question("", (answer) => {
      rl.close()
      process.stdout.write("\n")
      resolve(answer.trim())
    }),
  )
}
