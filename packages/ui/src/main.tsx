import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./App.tsx"
import { restoreThemePreference } from "./lib/theme.ts"
import "./app.css"

// Paint the saved theme before first render so there is no dark→light flash.
restoreThemePreference()

const root = document.getElementById("root")
if (!root) throw new Error("index.html is missing #root")

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
