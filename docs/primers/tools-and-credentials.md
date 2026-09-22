# Tools and credentials — a primer

What tools an agent can call, and how a usable credential for one is assembled
from an org-level part and a per-user part. Read `architecture.md` first; this
goes deep on one seam it names — the render binding identity — and on the store
behind it.

## The one idea

A tool _implementation_ is code. What an organization actually configures is the
metadata around it: which tools exist, how each one authenticates, and whether
calling it needs an operator's confirmation. That metadata is the **catalog**.
The catalog is fixed at build time (`tools/registry.ts`); credentials are data
an admin and each colleague fill in over the API (`tool-routes.ts`).

The whole area exists to answer one question at render time: _for this agent,
owned by this tenant, is this tool usable — and if so, with what credential?_ An
agent should never be shown a tool it could only fail with. Getting that right
across real integrations is what the rest of this document is about.

## Why a flat org/per-user axis was not enough

The obvious model is a single switch: a tool's credential is either the
organization's or each person's. Two real integrations break it.

- **OAuth tools (Gmail, Calendar, Slack)** need _two_ parts at once: an admin
  registers the OAuth app once (a `clientId`/`secret`), and then each person
  OAuths their own token against that app. Neither part alone is a working
  credential. A flat axis has no slot for "org config _and_ a personal token."
- **GCP** is one shared service account, but not everyone may use it. The
  credential is org-level; the _permission_ is per-user. There is a per-user
  thing to record, but it is a yes/no, not a secret. A flat axis assumes the
  per-user thing is always a key.

So a tool declares a **provisioning shape** instead — a named recipe for how its
credential is assembled. Two things the flat axis missed are exactly what the
shapes capture: **two-part credentials** (oauth) and **grant-without-secret**
(gcp).

## The five provisioning shapes

`ToolProvisioning` in `protocol/src/tools.ts`. Each shape reduces, via
`provisioningSpec()`, to two questions the registry can act on: must an org
secret be configured, and what must each user do (`none` / `token` / `grant`)?

| Shape                | Org secret? | Each user | Example                   | The thing it captures                                                               |
| -------------------- | ----------- | --------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `none`               | no          | nothing   | the clock; Docker sandbox | no credential — always on, or gated by a runtime probe                              |
| `org-key`            | yes         | nothing   | Firecrawl                 | one shared key runs it for everyone                                                 |
| `user-key`           | no          | a token   | (no built-in yet)         | each person's own API key, no org setup, no OAuth                                   |
| `oauth`              | yes         | a token   | Gmail, Calendar, Slack    | admin registers the app once; each person OAuths their own refresh token against it |
| `org-key-user-grant` | yes         | a grant   | GCP                       | one shared secret, usable only by people an admin has allowed — no per-user secret  |

`provisioningSpec()` is deliberately tiny: it is the one place the five shapes
collapse into the two axes the resolver understands. `none` is the only shape
whose usability can depend on something other than a stored credential — a
**runtime probe** the descriptor supplies (`available()`: is the Docker daemon
up), separate from any credential.

## The offer-or-not rule

The load-bearing decision lives in `resolveToolCredential()`
(`tools/registry.ts`). Given a descriptor and an owning tenant, it walks the
spec: if an org secret is required and none is configured, it returns
`undefined`; if a per-user token is required and none is connected, `undefined`;
if a grant is required and none is given, `undefined`. Otherwise it returns the
assembled `{ orgSecret?, userToken? }`.

**Returning `undefined` _is_ the offer-or-not decision, and the whole of it.**
`attachGrantedTools()` skips any tool that resolves to `undefined` (and, before
that, any whose `available()` probe fails). So an agent's toolset contains only
tools it can actually use — a missing key never becomes a tool that greets the
model and then errors on first call.

Because that decision is a pure function of a descriptor, a tenant and the
store, it is exported and tested directly, one case per shape, without a Flue
render frame (`tests/tools/registry.test.ts`). The real credential-backed tools
are deferred (see below), so the resolver is proved against a synthetic
descriptor per shape rather than against the tools themselves.

## Binding at render time

A resolved credential is not stored on the tool; it is bound _into_ the tool
when the agent attaches it, in the same seam that binds the tenant. The reason
is the reason the whole architecture rests on: **Flue does not tell a tool who
called it.** A job claimed from the poll loop has no request, no headers, no
ambient caller. So `StaffAgent`, at render, resolves the credential and builds
each tool with a `ToolContext` carrying `{ tenantId, agent, session, jobId?,
credential }`.

`ResolvedCredential` is just `{ orgSecret?, userToken? }` — the two parts a shape
can require. Note that `org-key-user-grant` binds an `orgSecret` but no
`userToken`: the grant gates whether the tool is offered at all, and once it is,
everyone granted runs the same shared secret. That asymmetry is the whole point
of the shape.

A descriptor's `build(context, attach)` takes an **`attach` callback** rather
than calling Flue's `useTool` itself. That indirection is deliberate: `attach`
is the seam the confirm-gate wraps. The default (`defaultAttach`) just mounts the
tool; M7 substitutes one that interposes the gate for `gated` tools. See
`confirm-gates.md` — outbound and irreversible tools (sending mail, deleting,
spending) are the gated ones.

## The credential store

`coordinator/tool-credentials.ts` — `ToolCredentialStore`. Three row shapes,
keyed by `scope`, and the resolver composes them per a tool's provisioning
shape:

- **`org`** — one shared secret per tool (a Firecrawl key, an OAuth app config).
  `tenant_id` is null; it belongs to the organization. Read with `orgSecret()`.
- **`user`** — one person's own token per tool (a Gmail refresh token). Scoped by
  `tenant_id` like any other row. Read with `userToken()`.
- **`grant`** — one person's _access_ to an org credential, **with no secret of
  its own** (GCP). It stores `hint: "granted"` and an empty secret; its only
  content is that the row exists. Read with `isGranted()`.

Writes go through `put()`, which upserts one row per shape so re-putting rotates
in place. A `grant` is an admin act naming the user it is for; the route
(`tool-routes.ts`) checks the admin role, as it does for any `org` write, since
both spend the organization's money or grant its access. A user owns their own
`user` rows. Secrets are **write-only over the API**: they go in, and only a
label and a `hint` (`sk-a…cret`) come back — `ToolCredential` has no secret
field, so listing credentials in the UI, the API or the audit log cannot leak
one.

## Encryption at rest

`coordinator/secrets.ts`. One `staffroom.db` holds several colleagues' API keys
and OAuth tokens, so a copy of that file is a copy of everyone's credentials.
Every stored secret is **AES-256-GCM**, per record, with a random IV each time
and the auth tag kept alongside — so a tampered ciphertext fails to decrypt
rather than decrypting to something else. The encoding is versioned from the
first write (`v1.<iv>.<tag>.<ciphertext>`, base64url) so the algorithm can change
later without a migration over unreadable data. The key is resolved the same way
the auth secret is (`resolveEncryptionKey()`), and hashed to 32 bytes with a
plain SHA-256 — not a slow KDF, because the generated key is already 32 random
bytes and there is no low-entropy passphrase for a slow hash to protect. Both
credential stores, tool and model, encrypt through this one module.

## Model credentials — a parallel but distinct thing

Model credentials (`coordinator/model-credentials.ts`,
`providers/registry.ts`) share the same encryption and the same _mine-plus-org_
visibility rule, but are a separate system with a separate twist. A model
credential is org or personal scope, holding either an API key or an imported
**Codex login** — the OAuth token record is imported into the server, not read
off some laptop's home directory, so the server owns the login and refreshes it
on the way out.

The twist: **each credential registers as its own Flue provider.** Flue keeps one
runtime per process and its provider registry is keyed by id, so there is no
"current tenant's provider" at the moment a model call happens. The way through
is to put the credential _in_ the provider identity (`anthropic-org`,
`anthropic-7f3a91c2…`, from `providerIdOf()`), so a per-tenant key works inside a
single process-global runtime — the tenant is chosen at render, exactly like a
tool credential. Aliasing a built-in provider means **re-stamping its model
catalog too**: a pi-ai `Model` carries its own `provider` field and auth resolves
from _that_, so aliasing the provider alone leaves every turn authenticating
against the built-in id — a bug that surfaced live as "Provider is not
configured." For the spend side of all this, see `audit-and-cost.md`.

## MCP servers are a separate family

Sentry, Notion and other MCP tools are **not** catalog descriptors. They are
reached through the MCP gateway and authenticate with per-user OAuth whose
endpoints the MCP server itself advertises (you are sent to the server, you
consent, you return with a token). The token storage is the same shape as
`oauth` here — only with discovered endpoints rather than admin-configured ones.
The gateway is a deferred verbatim lift.

## What is built, and what is deferred

Built concretely: the catalog, the store, the resolver, the render-time binding,
the encryption — and two no-credential tools that prove the attach path end to
end, `current_time` and `http_request` (both `provisioning: "none"`, neither
gated; a GET is a read).

Deferred verbatim lifts (M12): the credential-backed tool _implementations_ —
Firecrawl (`org-key`), the OAuth tools (`oauth`), GCP (`org-key-user-grant`),
the Docker sandbox (`none` + probe) — and the MCP gateway. The catalog and
credential architecture already holds their shapes; the resolution paths are
proved at the registry level with a synthetic descriptor per shape, so the day
those tools land, offering them is a solved problem.

## Where to go next

`confirm-gates.md` for what the `attach` seam wraps, and `audit-and-cost.md` for
how a model credential's spend becomes columns.
