const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const PORT = 3847;
let playerProcess;

function waitForPlayer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const check = () => {
      const request = http.get(`http://127.0.0.1:${PORT}/api/config`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) reject(new Error("The local player could not start."));
        else setTimeout(check, 250);
      });
      request.setTimeout(1_000, () => request.destroy());
    };
    check();
  });
}

async function openPlayer() {
  const playerRoot = app.isPackaged
    ? path.join(process.resourcesPath, "local-player")
    : path.join(__dirname, "..", "local-player");
  const configPath = path.join(app.getPath("userData"), "config.json");
  playerProcess = spawn(process.execPath, [path.join(playerRoot, "server.cjs")], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NO_OPEN_BROWSER: "1",
      NETPLUS_CONFIG_PATH: configPath,
    },
    windowsHide: true,
    stdio: "ignore",
  });
  playerProcess.unref();
  await waitForPlayer();

  const window = new BrowserWindow({
    width: 1420,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: "#07101b",
    title: "Netplus IPTV Player",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(openPlayer).catch((error) => {
  dialog.showErrorBox("Netplus IPTV Player", error.message);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => playerProcess?.kill());
