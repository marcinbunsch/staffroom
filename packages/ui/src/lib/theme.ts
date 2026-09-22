export type ThemePreference = "system" | "light" | "dark"

const THEME_KEY = "staffroom-theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === "light" || stored === "dark" ? stored : "system"
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === "system") localStorage.removeItem(THEME_KEY)
  else localStorage.setItem(THEME_KEY, preference)
  applyTheme(preference)
}

export function restoreThemePreference(): void {
  applyTheme(getThemePreference())
}

/** The theme currently painted, resolved from the DOM (so "system" reads real). */
export function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark"
}

// The design system is dark by default and switches to light only via a
// data-theme="light" attribute — it has no prefers-color-scheme fallback of its
// own. So "system" is resolved here: read the OS preference, set the attribute
// explicitly, and follow the OS while the preference stays on "system".
function applyTheme(preference: ThemePreference): void {
  const resolved = preference === "system" ? resolveSystemTheme() : preference
  paintTheme(resolved)
  watchSystemTheme(preference === "system")
}

/**
 * Set the painted theme, and — when running inside the native mobile shell —
 * match the iOS status-bar glyphs to it (dark UI ⇒ light glyphs, light UI ⇒ dark
 * glyphs). Uses the Capacitor global bridge directly so the web bundle keeps no
 * dependency on Capacitor; it's a no-op in the browser and desktop shell.
 */
function paintTheme(resolved: "light" | "dark"): void {
  document.documentElement.dataset.theme = resolved
  const cap = (window as { Capacitor?: NativeBridge }).Capacitor
  if (!cap?.isNativePlatform?.()) return
  // StatusBar.Style: "DARK" = light glyphs for a dark background; "LIGHT" = dark
  // glyphs for a light background.
  cap.Plugins?.StatusBar?.setStyle({ style: resolved === "dark" ? "DARK" : "LIGHT" })
}

type NativeBridge = {
  isNativePlatform?: () => boolean
  Plugins?: { StatusBar?: { setStyle: (options: { style: string }) => void } }
}

function resolveSystemTheme(): "light" | "dark" {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

let mediaQuery: MediaQueryList | undefined
function onSystemThemeChange(event: MediaQueryListEvent): void {
  paintTheme(event.matches ? "dark" : "light")
}

function watchSystemTheme(follow: boolean): void {
  mediaQuery ??= window.matchMedia(DARK_QUERY)
  mediaQuery.removeEventListener("change", onSystemThemeChange)
  if (follow) mediaQuery.addEventListener("change", onSystemThemeChange)
}
