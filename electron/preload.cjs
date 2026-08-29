const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stbPlay", {
  installUpdate: (url) => ipcRenderer.invoke("download-and-install-update", String(url || "")),
});
