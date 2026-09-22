const { contextBridge, ipcRenderer } = require("electron")

/**
 * The launcher window's bridge: list saved accounts, add one (a label + server
 * URL, verified before it is kept) or the local server, open one, or forget one
 * (which also clears that account's stored session).
 */
contextBridge.exposeInMainWorld("launcher", {
  list: () => ipcRenderer.invoke("staffroom:accounts:list"),
  add: (input) => ipcRenderer.invoke("staffroom:accounts:add", input),
  addLocal: () => ipcRenderer.invoke("staffroom:accounts:add-local"),
  open: (id) => ipcRenderer.invoke("staffroom:accounts:open", id),
  forget: (id) => ipcRenderer.invoke("staffroom:accounts:forget", id),
})
