import { useSyncExternalStore } from "react"
import { currentTheme } from "./theme.ts"

/**
 * The painted theme ("light" | "dark") as reactive state. Charts render to a
 * canvas/SVG with baked-in colours rather than CSS variables, so they cannot
 * follow a theme flip on their own — they have to re-run. This subscribes to the
 * one thing that changes: the `data-theme` attribute on <html> that
 * {@link import("./theme.ts").currentTheme} reads. A `useSyncExternalStore`
 * (not effect+state) so the first paint already matches the DOM.
 */
export function useTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, currentTheme, () => "dark")
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
  return () => observer.disconnect()
}
