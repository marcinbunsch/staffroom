import { builtinModules } from "node:module"
import { flue } from "@flue/vite"
import { type Plugin, defineConfig } from "vite"

/**
 * The desktop app's local server: the Flue app built
 * again, with its dependencies bundled in, into `dist-desktop/` — one directory
 * the app can carry. The pack step puts `desktop/entry.mjs` beside its `app.mjs`.
 *
 * The normal build keeps dependencies external and loads them from the
 * workspace's node_modules. A packed app has no workspace, and copying one in
 * would not work either: the workspace packages ship TypeScript source, which
 * Node will not load from inside node_modules. It has to be this same Flue build
 * rather than a second pass over `dist/`: that output has already turned its
 * CommonJS dependencies' `require("zod")`s into runtime lookups no bundler can
 * follow. One graph also keeps a single `@flue/runtime` instance, which is what
 * Flue's build protects.
 *
 * Only better-sqlite3 stays external — it loads a native addon from beside its
 * own files, so the pack step copies it in — along with Node's builtins.
 */
const EXTERNAL = [
  "better-sqlite3",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]

/** Replace the externals Flue derives from package.json, once every config hook has merged. */
function bundleDependencies(): Plugin {
  return {
    name: "staffroom-desktop-bundle-dependencies",
    enforce: "post",
    configResolved(config) {
      for (const environment of Object.values(config.environments)) {
        environment.build.rolldownOptions.external = EXTERNAL
      }
    },
  }
}

export default defineConfig({
  plugins: [flue(), bundleDependencies()],
  ssr: { noExternal: true },
  build: { outDir: "dist-desktop" },
})
