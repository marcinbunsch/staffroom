# Security

## Reporting a vulnerability

Report privately through GitHub's **[Report a vulnerability][advisories]**
button on the Security tab. It opens a private advisory that only the
maintainers can see. Please don't open a public issue for anything exploitable.

Include what you'd want if you were on the other end: what you did, what
happened, and what an attacker gets out of it. A proof of concept helps, even a
rough one.

Expect a first reply within a week. This is a small project, not a company with
a rota — if a fix needs time, you'll be told where it stands rather than left
waiting. Fixes are disclosed in the advisory once released, crediting you unless
you'd rather not be named.

[advisories]: ../../security/advisories/new

## What Staffroom assumes

Staffroom is built for a **self-hosted install serving a team that trusts each
other.** Many people share one process; each is a tenant with their own staff,
files, credentials and memory, and the tenant seam is enforced and tested. But
the threat model is "colleagues who should not see each other's data by
accident," not "mutually hostile tenants on shared infrastructure." Don't run it
as multi-tenant SaaS for strangers.

Two consequences worth stating plainly:

- **The tenant rides in the session key**, and every `/agents/*` request is
  checked against the caller before the agent runtime admits it. A bug in that
  guard is a cross-tenant data leak, and it is the thing to report fastest.
- **Encryption at rest protects a stolen backup, not a compromised host.** The
  key lives beside the database it unlocks unless a deployment sets
  `STAFFROOM_SECRET_KEY` from its own secret store.

## Known and accepted

[`docs/research/hardening.md`](docs/research/hardening.md) is the standing list
of trade-offs we have made on purpose, each with the residual risk and the fix
we would apply if the assumptions above stopped holding. It is published rather
than kept private so anyone deploying Staffroom can decide for themselves
whether those trade-offs fit their situation.

Things already listed there — currently the OAuth callback's account-injection
window, encryption-at-rest's limits, and the single crash domain — are known.
A report that one of them exists is not a new finding; a report that one is
worse than described, or is reachable in a way the note doesn't cover, very much
is.

## Prompt injection

An agent that can read outside content, reach private data, and send anything
out can be steered by whoever wrote the outside content. Staffroom does not
solve this, and no configuration of it does.
[`docs/research/lethal-trifecta.md`](docs/research/lethal-trifecta.md) sets out
where the project stands, what the confirm gates do and don't cover, and which
setups are safe today. The short version: Staffroom can be run safely, but the
unsafe setup is the easy one — so read that note before granting an agent a
tool that reaches the open internet alongside one that reaches your mail.

Injection-driven behaviour in an agent you configured that way is expected, not
a vulnerability. A way to bypass a **confirm gate**, escape the sandbox, or read
another tenant's data is a vulnerability.

## Running it safely

- Keep the server on loopback or a private network; put TLS in front of it.
- Set `STAFFROOM_AUTH_SECRET` and `STAFFROOM_SECRET_KEY` from your own secret
  store in production.
- Leave sign-up closed (the default after the first account).
- Back up `$STAFFROOM_HOME` — it holds the databases, the file bytes, and the
  keys that decrypt the stored credentials. Treat that backup as secret
  material.
