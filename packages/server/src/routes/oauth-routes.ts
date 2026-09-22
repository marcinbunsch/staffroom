import { Hono } from "hono"
import { getAuth } from "../core/auth.ts"
import { serverBaseUrl } from "../core/config.ts"
import { takeOAuthState } from "../coordinator/oauth-state.ts"
import { getToolCredentialStore } from "../coordinator/tool-credentials.ts"
import { getIntegration } from "../core/integrations.ts"
import { completeMcpOAuth } from "../core/mcp-oauth.ts"

/**
 * Public OAuth callbacks — mounted **before** the session gate, because a
 * provider's redirect is a top-level navigation that cannot be relied on to
 * carry our session cookie. Identity and CSRF come from the one-shot `state`
 * instead (see oauth-state), which the session-gated connect endpoint minted.
 *
 * One handler for every OAuth integration: it looks the integration up by name
 * and uses its own code-exchange.
 */
export const oauthRoutes = new Hono()

oauthRoutes.get("/oauth/:name/callback", async (context) => {
  const name = context.req.param("name")
  const integration = getIntegration(name)
  const label = integration?.label ?? name
  const state = context.req.query("state")
  const flow = state ? takeOAuthState(state) : undefined

  // The result is a standalone page, not a redirect into the app: consent may
  // have been finished in a browser that is not signed into Staffroom (the
  // copy-link case), where redirecting to the app would just bounce to sign-in
  // and hide that it worked. So we render the outcome ourselves, with a link
  // back for the signed-in browser.
  const done = (ok: boolean, returnTo?: string, message?: string) =>
    context.html(resultPage(ok, label, returnTo, message), ok ? 200 : 400)

  if (!flow) return done(false)
  const returnTo = `${flow.origin}/settings/integrations`

  // Defense in depth (docs/hardening.md). The callback is public — a provider's
  // redirect need not carry our cookie, and the copy-link flow finishes in a
  // browser with no session. But if a session *is* present, it must be the user
  // who started the flow; a mismatch is the account-injection CSRF, so refuse.
  const session = await getAuth().api.getSession({ headers: context.req.raw.headers })
  if (session && session.user.id !== flow.userId) {
    return done(
      false,
      returnTo,
      "This connection link was started by a different account. Sign in as that account, or start a new connection.",
    )
  }

  const store = getToolCredentialStore()

  // An auto-discovered MCP integration (Notion, Sentry): complete the PKCE
  // exchange keyed by the same `state`, and store the resulting per-user
  // credential (a refresh token, or a long-lived access token).
  if (integration?.kind === "mcp") {
    if (context.req.query("error") || !context.req.query("code") || !state) {
      return done(false, returnTo)
    }
    try {
      const userSecret = await completeMcpOAuth(state, context.req.query("code") ?? "")
      store.put(flow.userId, { scope: "user", tool: name, secret: userSecret })
      return done(true, returnTo)
    } catch (caught) {
      console.error(`[oauth] ${name} (mcp) callback failed:`, caught)
      return done(false, returnTo)
    }
  }

  const secret = store.orgSecret(name)
  let config: { clientId: string; clientSecret: string } | undefined
  try {
    const parsed = secret ? (JSON.parse(secret) as typeof config) : undefined
    // Trim: a client id/secret pasted with a trailing newline is otherwise sent
    // to the provider verbatim, which Slack rejects as bad_client_secret — an
    // error that reads like a wrong value rather than a stray whitespace.
    const clientId = parsed?.clientId?.trim()
    const clientSecret = parsed?.clientSecret?.trim()
    if (clientId && clientSecret) config = { clientId, clientSecret }
  } catch {
    config = undefined
  }
  if (!integration?.oauth || !config) return done(false, returnTo)
  if (context.req.query("error") || !context.req.query("code")) return done(false, returnTo)

  try {
    const userSecret = await integration.oauth.exchange(
      context.req.query("code") ?? "",
      config,
      // Must match the redirect URI used to start the flow — the server's.
      `${serverBaseUrl()}/oauth/${name}/callback`,
    )
    store.put(flow.userId, { scope: "user", tool: name, secret: userSecret })
    return done(true, returnTo)
  } catch (caught) {
    console.error(`[oauth] ${name} callback failed:`, caught)
    return done(false, returnTo)
  }
})

/**
 * A self-contained outcome page for the OAuth callback. The app's stylesheet is
 * not loaded here (this is served before the SPA), so the design tokens are
 * inlined as CSS variables — the same values as the app's theme, with a
 * `prefers-color-scheme` switch so it follows the OS in light and dark.
 */
function resultPage(ok: boolean, label: string, returnTo?: string, override?: string): string {
  const title = ok ? `${escapeHtml(label)} connected` : `Couldn't connect ${escapeHtml(label)}`
  const message = escapeHtml(
    override ??
      (ok
        ? "Your account is linked. Return to Staffroom and reload to start using it."
        : "Something went wrong, or the link expired. Try connecting again from Settings → Integrations."),
  )
  const icon = ok
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  const link = returnTo
    ? `<a class="btn" href="${escapeHtml(returnTo)}">Return to Staffroom</a>`
    : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{
  color-scheme:light dark;
  --canvas:#101013;--card:#15151a;--line:#212128;
  --ink:#ecebe8;--muted:#a3a09b;--label:#56545a;
  --control:#23232a;--control-hover:#32323d;
  --ok-bg:#17231a;--ok-fg:#7fb08a;--bad-bg:#241a19;--bad-fg:#dd6b62;
  --shadow:0 24px 60px rgba(0,0,0,.45);
}
@media (prefers-color-scheme:light){:root{
  --canvas:#f7f4ee;--card:#fffdf8;--line:#e3ded1;
  --ink:#201f1d;--muted:#6f6c65;--label:#98948b;
  --control:#e9e4d8;--control-hover:#d8d0be;
  --ok-bg:#e4eee7;--ok-fg:#3f7d52;--bad-bg:#f4e3e0;--bad-fg:#b2342a;
  --shadow:0 20px 50px rgba(60,50,30,.12);
}}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--canvas);color:var(--ink);display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:420px;padding:40px 36px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);animation:rise .35s cubic-bezier(.2,.7,.3,1) both}
.brand{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--label);margin:0 0 26px;font-weight:600}
.icon{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 20px;border-radius:50%;background:var(--${ok ? "ok" : "bad"}-bg);color:var(--${ok ? "ok" : "bad"}-fg)}
.icon svg{width:26px;height:26px}
h1{font-size:20px;font-weight:600;letter-spacing:-.2px;margin:0 0 10px}
p{color:var(--muted);font-size:14.5px;line-height:1.55;margin:0 auto;max-width:300px}
.btn{display:inline-block;margin-top:28px;padding:11px 22px;border-radius:10px;background:var(--control);color:var(--ink);text-decoration:none;font-size:14px;font-weight:500;transition:background .15s ease}
.btn:hover{background:var(--control-hover)}
@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
</style></head>
<body><div class="card"><div class="brand">Staffroom</div><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p>${link}</div></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  )
}
