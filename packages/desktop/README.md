# @staffroom/desktop

A thin Electron client for Staffroom. It connects to **servers** and opens the
exact web UI each server serves. Its one job beyond wrapping the UI is an
**account switcher** — and one of those accounts can be a server the app runs
itself, on this computer (see [Local server](#local-server)).

## How auth and the switcher work

The v2 web UI authenticates with same-origin better-auth cookies. Each account
window loads its server's URL directly, so the window's origin _is_ the server —
sign-in, the API client, and the live event stream all work exactly as they do
in a browser, with no server or UI changes.

Each account is pinned to its own persistent Electron **session partition**
(`persist:acct-<id>`), so accounts have independent cookie jars: you can be
signed into several at once and switch between them without logging out, and
sessions survive restarts. An account is just a label + a server URL; two
accounts can point at the same server as different users.

- **Accounts menu** — switch with ⇧⌘1…⇧⌘9; "Manage Accounts…" (⇧⌘K) or "Add Account…" opens the launcher.
- **Launcher window** — add an account (verified reachable before it's saved),
  open one, or forget one (which also clears that account's stored session).
- Each account keeps its own warm window, so switching is instant.
- **Native badge** — the app/Dock badge shows the total unread replies plus open
  attention items across open account windows, and clears as those items are read
  or resolved.

Accounts are stored in `<userData>/accounts.json`; there are no tokens on disk —
logins live in the partitions' cookie jars.

## Running

Point it at a server that is already running (e.g. `pnpm dev`, which serves the
UI at http://127.0.0.1:5317):

```
pnpm desktop            # from the repo root
# or
pnpm --filter @staffroom/desktop start
```

On first launch the launcher opens; add an account with the server URL. Plain
`http://` is allowed only for localhost — remote servers must use `https`.

### Dev against the hot-reloading UI

```
pnpm dev:desktop     # Vite UI (:5328) + the shell
```

In this mode every account window loads the hot-reloading **local UI** from Vite
instead of the account's built assets — but each window still talks to **its own
account's server**, chosen in the switcher. The shell tags each window's requests
with the account URL; Vite's dev proxy routes `/api`, `/agents` and `/oauth`
there. So the account switcher works exactly as normal, against local UI, one
server per window, with cookies isolated per account — no env var. Windows retry
while Vite is still starting, so launch order does not matter.

Run a server for an account to point at (e.g. `pnpm dev:server`), or add an
account for any reachable Staffroom server.

Caveats (dev-only): this suits **dev servers**, which trust the `127.0.0.1:5328`
origin. A production server would reject sign-in from that origin (better-auth
CSRF) unless it trusts it, and its `Secure` cookies will not stick over the
plain-http Vite origin.

## Local server

The launcher's **Run a server on this computer** adds the local account: a
Staffroom server the app runs itself, for you alone. Until you do that, the app
never starts one — an app that only connects to remote servers stays a pure
client.

- **Runs with the app once it exists.** From then on the server starts when the
  app launches and runs until it quits, whichever account you are on, so its
  schedules and jobs carry on while you work in another. It runs as an Electron
  utility process (Electron's own Node). On macOS it keeps running with no window
  open, like the app. The Local Server menu restarts it and shows its log and data
  folder. Forgetting the local account stops the server; its data is kept, so
  setting it up again picks up where it left off.
- **Loopback only.** The server binds `127.0.0.1` — port 4327, or a free one if
  that is taken, kept for next time — and refuses requests that name any other
  host, so neither the network nor a DNS-rebinding web page can reach it.
- **One user, signed in automatically.** The server runs with
  `STAFFROOM_SINGLE_USER=1`. For each start the app generates a token, passes it
  to the server (`STAFFROOM_LOCAL_TOKEN`), and opens the local account's window on
  `/api/auth/local/sign-in` with the token in a header; the server signs in its
  one account (creating it on first run) and redirects to the UI. Sign-up and
  adding accounts are closed, teams no longer gate toolsets, and the UI hides
  Teams, Accounts & roles and Sign out. A browser opened on the same port gets the
  sign-in page and no way in.
- **Its own data.** Everything is under `<userData>/local-server` —
  `data/` (its `STAFFROOM_HOME`, not `~/.staffroom`) and `logs/server.log`.

Run from source, the local server uses the workspace builds, so run `pnpm build`
first. A packed app is self-contained: `pnpm build:desktop` bundles the server
with every dependency into `packages/server/dist-desktop` (the workspace packages
ship TypeScript, which Node will not load from inside `node_modules`), and the
pack step stages that, the built UI, and better-sqlite3 with only the target's
prebuilt addon as `Resources/server`. `pnpm desktop:install` does all of it.

Only one instance of the app runs at a time, since the local server and its data
belong to one.

## Not yet here

The `~/.codex/auth.json` credential import is not wired up yet.
