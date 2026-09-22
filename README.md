# Staffroom

A self-hosted place to keep a team of AI agents at work.

Staffroom is one Node process that hosts the agents, owns the jobs and the
schedule, keeps the audit record, and serves the web UI — all behind a login.
A staff member is a row in a database: a name, a system prompt, a model, a
credential, a list of tools. Adding an agent is an insert, not a rebuild. The
browser, the CLI, the desktop app and the iOS app are all thin clients over the
same HTTP API.

It is built for a small team that runs its own server. Many people share one
process, and each one is a tenant with their own staff, files and memory.

> **Status: pre-1.0 and under active development.** It runs, it is tested
> (500+ tests), and it is used daily by its author — but the schema still moves,
> and nothing here is a stable public API yet. Read
> [SECURITY.md](SECURITY.md) before putting it anywhere but your own network.

## What it does

- **Staff.** Agents defined as data, each with its own prompt, model, tools and
  memory. One agent function becomes whichever member a session addresses.
- **Jobs.** When a request is more than a quick answer, an agent opens a job:
  its own session, a timeline, a deadline, spending caps, cost attribution.
- **Routines and events.** An internal event bus; routines are subscriptions to
  it, and a scheduled run is just a job with a cron trigger.
- **Tools and credentials.** A catalog of tools with five provisioning shapes
  (including OAuth and MCP), bound to a tenant's credentials at render time.
  Secrets are encrypted at rest.
- **Confirm gates.** A tool can be marked as needing approval; the turn suspends
  and waits for a person rather than blocking a thread.
- **Audit and cost.** Every turn is tapped; spend is a column, not an estimate.
- **Clients.** A React web UI, an Electron desktop shell with an account
  switcher, a Capacitor iOS shell, and a CLI.

## Quick start

Requires **Node 26+** and **pnpm 10.14.0** (pinned in `package.json`).
`better-sqlite3` compiles a native addon, so you need a working toolchain
(Xcode CLI tools on macOS, build-essential on Linux).

```bash
pnpm install
pnpm dev
```

That runs the API on `http://127.0.0.1:5317` and the UI on
`http://127.0.0.1:5318` — open the UI. The **first** account you sign up for
becomes the admin, and sign-up closes behind it. (Set `STAFFROOM_OPEN_SIGNUP=1`
to keep it open; see [.env.example](.env.example).)

If you need to create or recover the first admin from the command line:

```bash
pnpm --filter @staffroom/server admin you@example.com          # create
pnpm --filter @staffroom/server admin you@example.com --reset  # new password
```

The password is generated and printed once; it is never stored in the clear.

For a production build:

```bash
pnpm build
STAFFROOM_URL=https://staffroom.example.com pnpm serve
```

The server binds loopback by default. To expose it, set `STAFFROOM_HOST`
explicitly — and put it behind TLS. See
[Deploying](#deploying).

### State on disk

Everything Staffroom owns lives under one directory, `$STAFFROOM_HOME`
(`~/.staffroom` in production, `<checkout>/.staffroom` in dev): three SQLite
files, the file bytes, and the generated secrets. Back up that directory and you
have backed up the install. Delete it and you have a fresh one.

## Layout

A pnpm workspace, TypeScript, native ESM.

| Package                  | What it is                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| `@staffroom/protocol`    | Zod schemas — the source of truth for every type that crosses the wire.          |
| `@staffroom/server`      | The app: agents, tools, the coordinator, the HTTP API. Most of the code is here. |
| `@staffroom/ui`          | The React SPA, built to `dist/` and served by the server.                        |
| `@staffroom/client`      | A typed HTTP client over the API.                                                |
| `@staffroom/cli`         | The `staffroom` command.                                                         |
| `@staffroom/plugin-core` | The contract a deployment's own tools and integrations implement.                |
| `@staffroom/desktop`     | The Electron shell (a client, with an account switcher).                         |
| `@staffroom/mobile`      | The Capacitor iOS shell (a client).                                              |

Agents run on [Flue](https://flueframework.com); sessions and auth on
[better-auth](https://better-auth.com); everything else on SQLite.

Also in the repo: `docs/` (see below), `design/` — the design system as tokens,
components and static reference screens — and `examples/custom-plugin-example`,
a working plugin you can copy.

## Documentation

- **[`docs/primers/`](docs/primers/README.md)** — one document per area: the
  concepts, the decisions, and where the code lives. Start with
  [`architecture.md`](docs/primers/architecture.md).
- **[`docs/research/`](docs/research/)** — the security notes.
  [`hardening.md`](docs/research/hardening.md) lists the trade-offs we have
  knowingly accepted; [`lethal-trifecta.md`](docs/research/lethal-trifecta.md)
  is where we stand on prompt injection and data leaks.
- **[`docs/plans/`](docs/plans/)** — the design record: what was decided, why,
  and in what order it was built. Kept as history, so parts of it are out of
  date by design; each document says so where it is.

The primers are the ones to read before changing anything.

## Deploying

Staffroom assumes a trusted set of users — a self-hosted team where every
account is a colleague. It is not hardened for hostile tenants sharing one
install. Concretely:

- **Bind loopback and front it.** The default is `127.0.0.1`. Put it behind a
  reverse proxy or a private network (`tailscale serve` works well) rather than
  binding the wildcard.
- **Set the secrets yourself in production.** `STAFFROOM_AUTH_SECRET` and
  `STAFFROOM_SECRET_KEY` are generated into `$STAFFROOM_HOME` if you don't. That
  is fine for a laptop; for a deployment, keep them in your own secret store,
  because a key beside the data it unlocks protects only a stolen backup.
- **Set `STAFFROOM_URL`.** OAuth redirect URIs are built from it.
- **Read [`hardening.md`](docs/research/hardening.md) first** if your users are
  less trusted than that.

Every setting is listed in [.env.example](.env.example).

## Development

```bash
pnpm dev       # server + UI, hot reloading
pnpm test      # the test suites
pnpm check     # types, tests, lint and formatting — what CI runs
pnpm format    # apply formatting
```

Each git worktree gets its own `.staffroom` directory in dev, so parallel
branches never share a migration history. `rm -rf .staffroom` resets it.

## Contributing

Issues and pull requests are welcome. Two things worth knowing before you open
one:

- Run `pnpm check` — that is exactly what CI runs.
- Read the primer for the area you're touching. The codebase leans on written
  explanations over conventions, and a change that contradicts a primer needs to
  update it in the same commit.

Security issues go to the process in [SECURITY.md](SECURITY.md), not to the
issue tracker.

## License

[Apache License 2.0](LICENSE).
