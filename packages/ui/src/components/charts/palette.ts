/**
 * Chart colours, pulled live from the theme's CSS variables (theme.css) so a
 * chart matches the surrounding UI and follows a light/dark flip. Charting
 * libraries want concrete hex, not `var(--…)`, so we resolve the variables off
 * <html> once per render. Recompute on every theme change — call these from a
 * component that depends on {@link import("../../lib/use-theme.ts").useTheme}.
 *
 * The product palette is a closed, status-coded set (see theme.css); for a
 * categorical range we borrow its distinct accent hues in a fixed order —
 * blue, green, amber, red, teal, then muted — which reads as five clearly
 * separable series in both themes without inventing off-brand colours.
 */

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export type ChartPalette = {
  /** Categorical series colours, in assignment order. */
  categorical: string[]
  /** Axis/label text. */
  text: string
  /** De-emphasised text (axis titles, ticks). */
  textMuted: string
  /** Gridlines and axis rules. */
  grid: string
  /** Chart background — transparent so the card behind shows through. */
  background: string
  /** The primary single-series accent. */
  accent: string
  /**
   * Text on a saturated categorical fill (a filled node box). The theme's
   * inverse ink — light on the dark cream canvas, dark on the near-black
   * canvas — so it flips with the theme and stays readable on the blue, green,
   * red and teal fills, which those fills' own "muted text" tone does not.
   */
  onAccent: string
  /** Dark ink for the bright amber fill, which carries dark text in both themes. */
  onAttention: string
  /** The chart card's own background — a solid plate behind edge labels. */
  surface: string
}

export function chartPalette(): ChartPalette {
  return {
    categorical: [
      cssVar("--status-working"),
      cssVar("--status-done"),
      cssVar("--status-attention-fill"),
      cssVar("--status-failed"),
      cssVar("--status-confidential"),
      cssVar("--ink-muted"),
    ],
    text: cssVar("--ink-secondary"),
    textMuted: cssVar("--ink-muted"),
    grid: cssVar("--line-default"),
    background: "transparent",
    accent: cssVar("--status-working"),
    onAccent: cssVar("--surface-canvas"),
    onAttention: cssVar("--status-attention-ink"),
    surface: cssVar("--surface-card"),
  }
}
