/**
 * The CLI's type-check compiles the server's route sources (through
 * `@staffroom/client`'s Hono RPC types), which reach the server's Vite `?raw`
 * import of the sandbox Dockerfile. Mirrors the server's own env.d.ts, since
 * each program needs the declaration itself.
 */
declare module "*.Dockerfile?raw" {
  const content: string
  export default content
}
