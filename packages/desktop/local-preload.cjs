const { contextBridge, ipcRenderer } = require("electron")

/**
 * The bridge for the local account's window (preload.cjs is the remote one's).
 * The app signs the local server's one account in by itself, so beyond what a
 * remote window gets, the UI needs one thing: to ask for that sign-in again if
 * it finds no session.
 */
contextBridge.exposeInMainWorld("staffroom", {
  isDesktop: true,
  localServer: true,
  manageAccounts: () => ipcRenderer.invoke("staffroom:launcher:open"),
  signIn: () => ipcRenderer.invoke("staffroom:local:sign-in"),
  retry: () => ipcRenderer.invoke("staffroom:retry"),
  setBadgeCounts: (counts) => ipcRenderer.invoke("staffroom:badge:set", counts),
  // Put a file on the OS clipboard (see main.mjs); only where the shell can.
  copyFile:
    process.platform === "darwin" || process.platform === "linux"
      ? (file) => ipcRenderer.invoke("staffroom:clipboard:copy-file", file)
      : undefined,
})
