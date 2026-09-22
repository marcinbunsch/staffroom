import type { CapacitorConfig } from "@capacitor/cli"
import { KeyboardResize } from "@capacitor/keyboard"

/**
 * The Staffroom native mobile shell — a thin Capacitor client over a running
 * server, the phone analog of the Electron desktop app (packages/desktop).
 *
 * It holds no app logic: the WebView loads the server's own URL and runs the
 * exact web UI the server serves, authenticated same-origin. The shell adds only
 * native capabilities the web can't reach — push/badge, biometric gating, secure
 * token storage, and keyboard/network handling for the SSE chat UI.
 *
 * Phase 1 boots straight into one server: `STAFFROOM_MOBILE_SERVER_URL`, read at
 * sync time, since the URL is baked into the built app. The multi-account
 * switcher ("add server" selector) lands later: it will replace the static
 * `server.url` here with a bundled launcher page that navigates the WebView per
 * account. The URL is read in one place so that swap is a single edit.
 *
 * The placeholder below is not a real server — set the variable (in the
 * repo-root `.env`, or inline: `STAFFROOM_MOBILE_SERVER_URL=… pnpm mobile`)
 * before syncing, or the app boots to its offline fallback page.
 */
const DEFAULT_SERVER_URL =
  process.env.STAFFROOM_MOBILE_SERVER_URL?.trim() || "https://staffroom.example.com"

const config: CapacitorConfig = {
  appId: "com.staffroom.app",
  appName: "Staffroom",
  // Fallback bundle shown only if the remote server is unreachable at boot.
  webDir: "www",
  server: {
    url: DEFAULT_SERVER_URL,
    // Remote servers must be https (matches the desktop shell's isAllowed rule).
    cleartext: false,
  },
  ios: {
    // Go edge-to-edge: the WebView spans the full screen (under the status bar
    // and home indicator) and the web UI paints those regions with its own
    // theme background + pads content with env(safe-area-inset-*). "never" stops
    // the scroll view from adding its own insets on top of that (double insets).
    contentInset: "never",
  },
  plugins: {
    Keyboard: {
      // Resize the WebView (not just the visual viewport) when the keyboard
      // opens, so the fixed composer rides above it instead of being covered.
      resize: KeyboardResize.Native,
    },
    StatusBar: {
      // Draw the WebView under the status bar so the app's own background shows
      // through it (edge-to-edge). Glyph color is set at runtime from the app's
      // theme in packages/ui/src/lib/theme.ts. "DARK" = light glyphs, matching
      // the design system's dark default until the UI syncs it.
      overlaysWebView: true,
      style: "DARK",
    },
  },
}

export default config
