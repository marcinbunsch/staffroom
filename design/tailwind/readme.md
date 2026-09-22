# Staff — Tailwind v4 build

The Tailwind port of the Staff design system. Same components, same rules, same
palette — expressed as utilities instead of inline styles.

## What's here

```
tailwind/
  theme.css                 the whole system: variable layer + @theme + base
  assets/logo.png           the mark used in the rail
  design-system.html        every token + component specimen, with class strings
  staff-home.html           static reference build of the Home screen
  staff-agent-thread.html   static reference build of the agent thread (Steward)
  staff-settings.html       static reference build of Settings (all six sections)
  chat-history-dialog.html  ThreadTabs + ChatHistory, with a redesign rationale
  composer.html             Composer states (rest, drafting, drag), with rationale
  components/core/          9 primitives (.jsx + .d.ts + .prompt.md)
  components/patterns/      12 patterns (.jsx + .d.ts + .prompt.md)
```

Component props are unchanged from `/components/`, with one exception: `Button`
takes `className` instead of `style`.

## Install

```bash
npm i tailwindcss @tailwindcss/vite   # or the PostCSS plugin
```

Your app's stylesheet becomes one line:

```css
@import "./tailwind/theme.css";
```

`theme.css` imports Tailwind itself, plus IBM Plex Sans/Mono and the Tabler icon
webfont — so this is the only stylesheet you need, and there is nothing to add to
your document head. Don't import Tailwind separately.

The folder is self-contained: no file references anything outside `tailwind/`.
The two font/icon `@import url()` lines at the top of `theme.css` are the only
network dependencies — replace them with self-hosted `@font-face` rules for
production and nothing else changes.

**The three HTML pages are dev references only.** They run the pinned CDN browser
build with the theme inlined, plus a small guard that retries the compiler if the
host drops the script. Your app compiles `theme.css` at build time and needs
neither. Do not copy that pattern into production.

`staff-home.html` is the exception to that setup: it runs the CDN browser build
and inlines the theme, because a relative `@import` isn't resolved there. It's a
read-only reference for developers, not a file to build on.

## Theming

Two layers, and the split matters:

1. **The variable layer** (`:root`, `[data-theme="light"]`) holds every hex.
2. **`@theme inline`** maps those variables into Tailwind's namespaces, which is
   what generates the utilities. The `inline` keyword is load-bearing — without
   it Tailwind bakes the dark hex into each utility and the light theme never
   applies.

Switching themes is one attribute:

```js
document.documentElement.dataset.theme = "light" // or "dark"
```

There is no `dark:` variant in this system. A `dark:` class would double every
colour decision and drift from the variable layer — don't add one.

## Token map

| Old CSS variable                                               | Tailwind utility                                                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bg-canvas`, `--bg-card`, `--bg-control` …                   | `bg-surface-canvas`, `bg-surface-card`, `bg-surface-control` …                                                                                                                         |
| _(new)_ `--surface-control-active`                             | `bg-surface-control-active` — primary button hover                                                                                                                                     |
| `--border-subtle`, `--border-default`, `--border-hover-accent` | `border-line-subtle`, `border-line-default`, `border-line-accent`                                                                                                                      |
| `--text-primary`, `--text-muted`, `--text-faint` …             | `text-ink-primary`, `text-ink-muted`, `text-ink-faint` …                                                                                                                               |
| `--status-working`, `--status-attention` …                     | `bg-status-working`, `text-status-attention` …                                                                                                                                         |
| _(new)_ `--status-attention-fill`                              | `bg-status-attention-fill` — amber **fills** (approve button, unread badge). `bg-status-attention` stays for text, dots and spines, and is darker in light theme so it reads on cream. |
| `--tint-attention`, `--tint-failed`                            | `bg-tint-attention`, `bg-tint-failed`                                                                                                                                                  |
| `--size-title` … `--size-label`                                | `text-title`, `text-heading`, `text-subheading`, `text-body`, `text-secondary`, `text-meta`, `text-mono`, `text-label`                                                                 |
| `--radius-chip` … `--radius-panel`                             | `rounded-chip`, `rounded-monogram`, `rounded-control`, `rounded-row`, `rounded-card`, `rounded-panel`                                                                                  |
| `--motion-pulse`, `--motion-ring`, `--motion-bar`              | `animate-pulse-dot`, `animate-pulse-ring`, `animate-bar-slide`                                                                                                                         |
| `--layout-rail`, `--layout-tabbar`                             | `w-rail`, `h-tabbar`                                                                                                                                                                   |
| `--layout-content-max`, `--layout-prose-max`                   | `max-w-content`, `max-w-copy`                                                                                                                                                          |

Text colours were renamed `--text-*` → `--ink-*`: in Tailwind v4 the `--text-*`
namespace belongs to font sizes, and the two would have collided.

The 720px prose measure is `max-w-copy`, not `max-w-prose`. Tailwind's
`max-w-prose` is a static 65ch utility (~507px at this type size) and a theme
token cannot override it — use `max-w-copy` for body copy.

## Gotcha: overflow-x

Use `overflow-x-clip`, never `overflow-x-hidden`, on `html`/`body` or any
ancestor of a sticky element. `hidden` makes the element a scroll container,
which silently disables `position: sticky` in every descendant — the rail and
the composer both depend on this.

## Rules that don't change

The system's rules, restated for a utility rewrite — these are the ones most
easily lost:

- **Colour is a status channel.** No stock palette colours, no colour for
  hierarchy or emphasis. At rest a screen shows at most one amber block and one
  red block.
- **No shadows.** Depth is surface steps plus a 1px border. There is no
  elevation scale, so `shadow-*` should never appear.
- **One breakpoint, for chrome only.** Use the `mobile:` / `desktop:` variants
  defined at the bottom of `theme.css` (900px). Tailwind's `sm: md: lg: xl:` are
  unused — content is fluid via `flex-wrap` + flex-basis, `clamp()` padding, and
  `grid-cols-[repeat(auto-fit,minmax(min(100%,Npx),1fr))]`.
- **Motion is for live work only.** The three `animate-*` utilities exist for
  working states. Nothing animates for idle, failed, or done, and nothing has an
  entrance animation.
- **Hover changes colour, never geometry.** No `hover:scale-*`, no
  `hover:-translate-y-*`, no transitions on transform.
- **Arbitrary values are fine.** This system's spacing (18px card padding, 13px
  gaps, 7px dots) predates Tailwind's 4px scale; `p-[18px]` is correct and
  honest. Don't round it to `p-5` to look tidier.

## Use with Claude Code

Drop the folder into your repo and point Claude Code at it:

```bash
cp -r tailwind/ <your-repo>/design/staff/
cd <your-repo> && claude
```

Then, in the session:

> Read design/staff/readme.md and design/staff/theme.css, then the
> `.prompt.md` next to each component. Build the Home screen in our app using
> those components and tokens only.

What each file is for, in that context:

| File                        | Role in the handoff                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `readme.md`                 | The rules. Read first — it says what not to do (no `dark:`, no `shadow-*`, no `sm:`/`md:`).                                      |
| `theme.css`                 | The single source of every token. Import it; don't re-declare values.                                                            |
| `components/**/*.prompt.md` | Per-component spec: purpose, props, class strings, states, and the reference implementation. Written to be pasted into a prompt. |
| `components/**/*.jsx`       | Working React source. Copy in as-is, or translate to Vue/Svelte/SwiftUI — the classes are the contract, the framework isn't.     |
| `components/**/*.d.ts`      | Prop types, so Claude Code gets the API right without reading the JSX.                                                           |
| `staff-*.html`              | Composition references — how the parts assemble into real screens. Not production code; they run the CDN compiler.               |
| `design-system.html`        | Every token and specimen with its class string, for lookups.                                                                     |

Two things worth telling it explicitly, because they're the common mistakes:
replace the two `@import url()` font lines in `theme.css` with self-hosted
`@font-face` rules, and keep `@theme inline` — dropping `inline` breaks the
light theme.

If your repo already has a `CLAUDE.md`, add one line to it:

```md
UI follows design/staff/ — read design/staff/readme.md before writing any component.
```

That way the rules apply to every future session without re-explaining them.
