import { contextBridge, ipcRenderer } from "electron";
import type { VaultAPI } from "../shared/types";
const api: VaultAPI = {
  request: (command) => ipcRenderer.invoke("vault:request", command),
  onLock: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("vault:locked", listener);
    return () => ipcRenderer.removeListener("vault:locked", listener);
  },
};
contextBridge.exposeInMainWorld("vault", Object.freeze(api));
