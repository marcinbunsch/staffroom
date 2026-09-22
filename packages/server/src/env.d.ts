/** Vite's `?raw` imports (the sandbox Dockerfile is bundled as a string). */
declare module "*.Dockerfile?raw" {
  const content: string
  export default content
}
