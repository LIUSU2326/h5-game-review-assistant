import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopDir, "..");
const appIcon = path.join(projectRoot, "desktop", "icon.ico");

process.env.H5_APP_ROOT = projectRoot;
process.env.H5_NODE_EXECUTABLE = process.execPath;
process.env.H5_ELECTRON_RUN_AS_NODE = "1";

let serverInfo = null;
let mainWindow = null;

function resolveDataRoot() {
  if (process.env.H5_DATA_ROOT) return path.resolve(process.env.H5_DATA_ROOT);
  if (app.isPackaged) return path.join(path.parse(app.getPath("exe")).root, "H5游戏评测助手数据");
  return projectRoot;
}

async function createWindow() {
  process.env.H5_DATA_ROOT = resolveDataRoot();
  if (!serverInfo) {
    const { startAppServer } = await import("../tools/app_server.mjs");
    serverInfo = await startAppServer({ port: 0 });
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: "H5 游戏评测助手",
    icon: appIcon,
    backgroundColor: "#f7f7f4",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(serverInfo.url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(serverInfo.url);
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverInfo?.server?.close();
});
