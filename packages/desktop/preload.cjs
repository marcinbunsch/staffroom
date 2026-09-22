const { contextBridge, ipcRenderer } = require("electron")

/**
 * Exposed to the web UI running inside an account window. Auth is cookie-based
 * and same-origin, so the UI needs nothing from the shell to talk to its server;
 * this only lets the UI know it is inside the desktop app and offer a way back
 * to the account launcher. Kept deliberately tiny.
 */
contextBridge.exposeInMainWorld("staffroom", {
  isDesktop: true,
  manageAccounts: () => ipcRenderer.invoke("staffroom:launcher:open"),
  retry: () => ipcRenderer.invoke("staffroom:retry"),
  setBadgeCounts: (counts) => ipcRenderer.invoke("staffroom:badge:set", counts),
  // Put a file on the OS clipboard (see main.mjs); only where the shell can.
  copyFile:
    process.platform === "darwin" || process.platform === "linux"
      ? (file) => ipcRenderer.invoke("staffroom:clipboard:copy-file", file)
      : undefined,
})
