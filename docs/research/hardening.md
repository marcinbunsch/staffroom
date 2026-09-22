# Hardening notes

Known security trade-offs and the residual risks we have accepted for now, with
the recommended fix for each. This is the place to look before a deployment that
faces a less-trusted set of users than a self-hosted team.

## OAuth callback: account-injection CSRF

**Where:** `GET /oauth/:name/callback` (`packages/server/src/routes/oauth-routes.ts`).

**Why it's public.** The callback is mounted _before_ the session gate. A
provider's redirect (Google, Slack) is a top-level navigation that cannot be
relied on to carry our session cookie — and by design the flow can be finished
in a _different browser_ (the "copy link" connect option), which has no session
at all. So the callback cannot authenticate by session.

**Current protection.** A one-shot `state` (`coordinator/oauth-state.ts`): 24
random bytes, a 10-minute TTL, consumed on use, and bound server-side to the
user who started the flow. Only the session-gated connect endpoint can mint one.
This stops forgery and ordinary CSRF: an attacker cannot fabricate a valid
callback, and the token is stored for whoever the state names.

**Residual risk — account injection.** An attacker with their _own_ session
mints a state, then induces a victim to complete consent (e.g. by sending them
the attacker's consent link). The victim authorizes with _their_ provider
account, and the resulting token is stored under the **attacker's** Staffroom
account. The attacker gains read access to the victim's Gmail/Slack _through
their own account_. This is the standard OAuth "login/authorization CSRF" and
the `state` nonce does not close it, because the state legitimately belongs to
the attacker.

We accept the remainder for a self-hosted, small-team deployment, where every
account is a colleague and the consent screen names the victim's own account.

**Implemented (defense in depth).** On the callback, if a session cookie _is_
present, it must match the state's `userId`; a mismatch is refused with a clear
message. This closes the same-browser injection — the common vector — while
still allowing the intentional cross-browser copy-link case (no session there,
so the check is skipped). See `oauth-routes.ts`.

**Still open (optional).** Validate `state.origin` against an allowlist before
using it in the "return to Staffroom" link, rather than trusting the value the
connect call supplied. Low impact: the origin is set by the caller's own
authenticated client, so it only affects their own flow.

## Encryption at rest is a stolen-backup control only

Stored secrets (model credentials, tool/OAuth tokens) are AES-256-GCM encrypted
with a key kept next to the database (`STAFFROOM_SECRET_KEY`, else a generated
file). This protects a stolen backup, a synced folder, or a disk image. It does
**not** protect against an attacker who already has the process environment — the
key sits beside the data it unlocks unless a deployment sets the key from a
separate secret store. Stated so it is not mistaken for more than it is.

## One crash domain

All agents run in one process (Flue's one-runtime-per-process model). A crash
pauses the whole team. Accepted and reversible additively (a supervisor plus a
proxy, no store rewrite); recorded here so it is a scheduling decision, not a
surprise.
