/**
 * The client's type-check compiles the server's route sources (for the Hono RPC
 * types), which reach the server's Vite `?raw` import of the sandbox
 * Dockerfile. The server's own program declares this too (its env.d.ts); this
 * mirror keeps the client program compiling without vite's client types.
 */
declare module "*.Dockerfile?raw" {
  const content: string
  export default content
}
