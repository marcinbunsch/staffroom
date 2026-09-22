import { useEffect, useState } from "react"

/**
 * Whether the UI is running inside the Electron desktop shell (as opposed to a
 * browser). The shell's preload sets `window.staffroom`; this is a constant for
 * the session, so it needs no hook. Used to reserve space for the frameless
 * window's traffic lights and to add a draggable region.
 */
export function isDesktopShell(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as { staffroom?: { isDesktop?: boolean } }).staffroom?.isDesktop)
  )
}

/** Update the native app/Dock badge when the Electron shell is present. */
export function setDesktopBadgeCounts(unread: number, attention: number): void {
  if (typeof window === "undefined") return
  const bridge = (
    window as {
      staffroom?: {
        isDesktop?: boolean
        setBadgeCounts?: (counts: { unread: number; attention: number }) => Promise<unknown>
      }
    }
  ).staffroom
  if (bridge?.isDesktop) void bridge.setBadgeCounts?.({ unread, attention })
}

type CopyResult = { ok: boolean; error?: string }
type CopyFile = (file: { name: string; text: string }) => Promise<CopyResult>

function copyFileBridge(): CopyFile | undefined {
  if (typeof window === "undefined") return undefined
  return (window as { staffroom?: { copyFile?: CopyFile } }).staffroom?.copyFile
}

/**
 * Whether the shell can put a file (not just text) on the clipboard. A browser
 * cannot, so "Copy as file" is desktop-only.
 */
export function canCopyFile(): boolean {
  return isDesktopShell() && copyFileBridge() !== undefined
}

/**
 * Ask the shell to put a file with this name and text on the OS clipboard.
 * Resolves with why it failed, if it did; never rejects.
 */
export async function copyAsFile(name: string, text: string): Promise<CopyResult> {
  const copyFile = copyFileBridge()
  if (!copyFile) return { ok: false, error: "This app cannot copy files." }
  try {
    return await copyFile({ name, text })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

interface LocalServerBridge {
  localServer?: boolean
  signIn?: () => Promise<unknown>
}

function localServerBridge(): LocalServerBridge | undefined {
  if (typeof window === "undefined") return undefined
  return (window as { staffroom?: LocalServerBridge }).staffroom
}

/**
 * Whether the UI is the desktop app's local account — its window onto the
 * single-user server the app runs, which the app signs in on the user's behalf.
 */
export function isLocalServerShell(): boolean {
  return isDesktopShell() && Boolean(localServerBridge()?.localServer)
}

/** Ask the desktop app to sign the local account in again (the session is gone). */
export function requestLocalSignIn(): void {
  void localServerBridge()?.signIn?.()
}

/**
 * Whether the viewport is desktop-width — the JS side of the `desktop:` Tailwind
 * variant (`min-width: 901px`). Used where behaviour, not just layout, differs:
 * on mobile Enter is a newline and the Send button sends; on desktop Enter sends.
 */
const DESKTOP_QUERY = "(min-width: 901px)"

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return isDesktop
}
