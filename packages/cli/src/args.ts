export interface Flags {
  [name: string]: string | boolean | undefined
}

export interface Parsed {
  positionals: string[]
  flags: Flags
}

/**
 * A minimal flag parser: `--name value`, `--name=value` and bare `--name`
 * (boolean), plus `-a`/`--account` and `-o`/`--out`. Everything else is a
 * positional. Kept dependency-free so the CLI stays a thin, obvious shell over
 * the client.
 */
export function parseArgs(argv: readonly string[]): Parsed {
  const positionals: string[] = []
  const flags: Flags = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === "-a" || arg === "--account") {
      flags.account = argv[++index] ?? ""
      continue
    }
    if (arg === "-o" || arg === "--out") {
      flags.out = argv[++index] ?? ""
      continue
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s)
      if (!name) continue
      const next = argv[index + 1]
      if (inline !== undefined) flags[name] = inline
      else if (next !== undefined && !next.startsWith("-")) flags[name] = argv[++index] ?? true
      else flags[name] = true
      continue
    }
    positionals.push(arg)
  }
  return { positionals, flags }
}

/** Read a flag as a string, treating a bare `--flag` (boolean true) as absent. */
export function flag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}
