import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  Menu,
  Tray,
  nativeImage,
  session,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { VaultService } from "./service";
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let service: VaultService;
let queue = Promise.resolve();
app.setName("Vaultriad");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("no-pings");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch(
  "disable-features",
  "AutofillServerCommunication,MediaRouter,OptimizationHints",
);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const rendererURL = process.env.ELECTRON_RENDERER_URL;
    const productionURL = pathToFileURL(
      join(__dirname, "../renderer/index.html"),
    ).href;
    service = new VaultService(() => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send("vault:locked");
      updateTray();
    });
    try {
      await service.init();
    } catch {
      const { dialog } = await import("electron");
      await dialog.showMessageBox({
        type: "error",
        message: "Vaultriad could not read your vault",
        detail:
          "Preserve the vault files in your application data folder. The app will exit without changing them. Use an intact backup or the rolling .previous copy to recover.",
      });
      app.quit();
      return;
    }
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Vaultriad",
          submenu: [
            {
              label: "About Vaultriad",
              click: () => void service.execute({ type: "about" }),
            },
            { type: "separator" },
            {
              label: "Lock",
              accelerator: "CommandOrControl+L",
              click: () => service.lock(),
            },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
      ]),
    );
    window = new BrowserWindow({
      title: "Vaultriad",
      width: 1320,
      height: 860,
      minWidth: 940,
      minHeight: 680,
      backgroundColor: "#101312",
      show: false,
      icon: join(__dirname, "../../assets/icon.png"),
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
        webSecurity: true,
      },
    });
    window.setContentProtection(true);
    window.once("ready-to-show", () => window?.show());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Renderer and its static assets are the only requests allowed. Optional breach requests run in main through Node fetch.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed =
        details.url.startsWith("file://") ||
        details.url.startsWith("devtools://");
      if (!app.isPackaged && rendererURL) {
        const origin = new URL(rendererURL).origin;
        try {
          const u = new URL(details.url);
          allowed =
            allowed ||
            u.origin === origin ||
            (u.protocol === "ws:" && u.host === new URL(origin).host);
        } catch {}
      }
      callback({ cancel: !allowed });
    });
    ipcMain.handle("vault:request", (event, input) => {
      const expected =
        rendererURL && !app.isPackaged
          ? new URL(rendererURL).href
          : productionURL;
      const frameURL = event.senderFrame?.url?.split("#")[0];
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        frameURL !== expected
      )
        return { ok: false, error: "Untrusted request." };
      const task = queue.then(async () => {
        try {
          const data = await service.execute(input);
          updateTray();
          return { ok: true, data };
        } catch (e) {
          const error = e instanceof Error ? e.message : "Operation failed.";
          return {
            ok: false,
            error: error.startsWith("[\n") ? "Invalid request." : error,
          };
        }
      });
      queue = task.then(() => {});
      return task;
    });
    tray = new Tray(
      nativeImage.createFromPath(join(__dirname, "../../assets/tray.png")),
    );
    updateTray();
    tray.on("click", () => {
      window?.show();
      window?.focus();
    });
    powerMonitor.on("suspend", () => service.lock());
    powerMonitor.on("lock-screen", () => service.lock());
    setInterval(() => service.tick(), 1000).unref();
    if (rendererURL && !app.isPackaged) await window.loadURL(rendererURL);
    else await window.loadFile(join(__dirname, "../renderer/index.html"));
    window.on("closed", () => {
      window = null;
      service.lock();
      app.quit();
    });
  });
  app.on("before-quit", () => service?.lock());
  app.on("window-all-closed", () => app.quit());
}
function updateTray() {
  if (!tray || tray.isDestroyed() || !service) return;
  tray.setToolTip(
    `Vaultriad (${service.status().unlocked ? "Unlocked" : "Locked"})`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Vaultriad",
        click: () => {
          window?.show();
          window?.focus();
        },
      },
      {
        label: "Lock",
        enabled: service.status().unlocked,
        click: () => service.lock(),
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}
