import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } from "electron";
import type { OpenDialogOptions } from "electron";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChatMessage, SkillAutoMessageSettings, SkillDraft, SkillSourceKind } from "@chaq/shared";
import { LocalDatabase } from "./local-db";
import { callUserModel, detectUserModelProvider, testUserModelConfig } from "./model-adapters";

let mainWindow: BrowserWindow | null = null;
let localDb: LocalDatabase;
let dragTarget: BrowserWindow | null = null;
let dragOffset = { x: 0, y: 0 };
let dragSize = { width: 0, height: 0 };
let dragTimer: ReturnType<typeof setInterval> | null = null;

const chaqEnvironmentRoot = join(process.env.CHAQ_ENV_ROOT || "E:\\Environment", "Chaq");
const chaqUserDataPath = join(chaqEnvironmentRoot, "user-data");
const chaqRuntimeCachePath = process.env.CHAQ_RUNTIME_CACHE || join(chaqEnvironmentRoot, "runtime-cache-v2");
const chaqDiskCachePath = join(chaqRuntimeCachePath, "chromium");
const chaqSessionDataPath = join(chaqRuntimeCachePath, "session-data");
const rendererFileUrl = pathToFileURL(join(__dirname, "../renderer/index.html"));

mkdirSync(chaqUserDataPath, { recursive: true });
mkdirSync(chaqDiskCachePath, { recursive: true });
mkdirSync(chaqSessionDataPath, { recursive: true });
const previousLocalStorage = join(chaqUserDataPath, "Local Storage");
const migratedLocalStorage = join(chaqSessionDataPath, "Local Storage");
if (!existsSync(migratedLocalStorage) && existsSync(previousLocalStorage)) {
  cpSync(previousLocalStorage, migratedLocalStorage, { recursive: true });
}
app.setPath("userData", chaqUserDataPath);
app.setPath("sessionData", chaqSessionDataPath);
app.commandLine.appendSwitch("disk-cache-dir", chaqDiskCachePath);
if (process.env.NODE_ENV !== "production" && /^\d{2,5}$/.test(process.env.CHAQ_DEVTOOLS_PORT ?? "")) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.CHAQ_DEVTOOLS_PORT);
}

// electron-vite shares electron.exe with other local apps, so its strict port
// check is the reliable development lock. Packaged Chaq keeps the OS lock.
const hasSingleInstanceLock = Boolean(process.env.ELECTRON_RENDERER_URL) || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function isTrustedRendererUrl(target: string): boolean {
  try {
    const targetUrl = new URL(target);
    if (process.env.ELECTRON_RENDERER_URL) {
      return targetUrl.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
    }
    return targetUrl.protocol === "file:" && targetUrl.pathname === rendererFileUrl.pathname;
  } catch {
    return false;
  }
}

function hardenWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isTrustedRendererUrl(target)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (!isTrustedRendererUrl(target)) event.preventDefault();
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload failed (${preloadPath}): ${error.message}`);
  });
  window.webContents.on("did-fail-load", (_event, code, description, target) => {
    console.error(`Renderer load failed (${code}) ${description}: ${target}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process exited: ${details.reason} (${details.exitCode})`);
  });
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    if (level >= 2) console.error(`Renderer console [${source}:${line}]: ${message}`);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 380,
    minHeight: 560,
    title: "Chaq",
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: "#121217",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  hardenWindow(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("skills:list", () => localDb.listSkills());
  ipcMain.handle("skills:get", (_event, id: string) => localDb.getSkill(id));
  ipcMain.handle("skills:create", (_event, payload: { skill: SkillDraft; sourceKind?: SkillSourceKind; id?: string }) =>
    localDb.createSkill(payload.skill, payload.sourceKind, payload.id)
  );
  ipcMain.handle("skills:update", (_event, payload: { id: string; skill: SkillDraft; sourceKind?: SkillSourceKind }) =>
    localDb.updateSkill(payload.id, payload.skill, payload.sourceKind)
  );
  ipcMain.handle("skills:delete", (_event, id: string) => localDb.deleteSkill(id));
  ipcMain.handle("skills:versions", (_event, skillId: string) => localDb.listVersions(skillId));
  ipcMain.handle("skills:auto-settings:get", (_event, skillId: string) => localDb.getSkillAutoMessageSettings(skillId));
  ipcMain.handle("skills:auto-settings:save", (_event, settings: SkillAutoMessageSettings) =>
    localDb.saveSkillAutoMessageSettings(settings)
  );

  ipcMain.handle("messages:list", (_event, skillId: string) => localDb.listMessages(skillId));
  ipcMain.handle("messages:add", (_event, payload: { skillId: string; role: ChatMessage["role"]; content: string; modelLabel?: string | null }) =>
    localDb.addMessage(payload)
  );
  ipcMain.handle("messages:clear", (_event, skillId: string) => localDb.clearMessages(skillId));

  ipcMain.handle("imports:open-file", async () => {
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        { name: "Chat exports", extensions: ["txt", "csv", "json", "html", "htm", "md", "markdown"] },
        { name: "All files", extensions: ["*"] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const filePath = result.filePaths[0];
    return {
      filePath,
      fileName: filePath.split(/[\\/]/).pop() ?? "import.txt",
      content: await readFile(filePath, "utf8")
    };
  });
  ipcMain.handle("imports:save", (_event, payload: Parameters<LocalDatabase["saveImport"]>[0]) => localDb.saveImport(payload));

  ipcMain.handle("files:open-background-image", () => openImageFile());
  ipcMain.handle("files:open-image", () => openImageFile());

  ipcMain.handle("files:open-folder", async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("models:list-user", (_event, userId?: string) => localDb.listUserModelConfigs(userId));
  ipcMain.handle("models:save-user", (_event, payload: Parameters<LocalDatabase["saveUserModelConfig"]>[0]) =>
    localDb.saveUserModelConfig(payload)
  );
  ipcMain.handle("models:delete-user", (_event, payload: { id: string; userId?: string }) =>
    localDb.deleteUserModelConfig(payload.id, payload.userId)
  );
  ipcMain.handle("models:test-user", (_event, payload: Parameters<typeof testUserModelConfig>[0]) =>
    testUserModelConfig(payload)
  );
  ipcMain.handle("models:detect-user-provider", (_event, apiKey: string) =>
    detectUserModelProvider(apiKey)
  );
  ipcMain.handle(
    "models:user-chat",
    async (
      _event,
      payload: {
        userId?: string;
        configId: string;
        skill: SkillDraft;
        messages: Pick<ChatMessage, "role" | "content">[];
      }
    ) => callUserModel(localDb.getSecretModelConfig(payload.configId, payload.userId), payload.skill, payload.messages)
  );

  ipcMain.handle("window:minimize", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    target?.minimize();
  });
  ipcMain.handle("window:maximize", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!target) return;
    if (target.isMaximized()) {
      target.unmaximize();
    } else {
      target.maximize();
    }
  });
  ipcMain.handle("window:close", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    stopWindowDrag();
    if (target && target === mainWindow) {
      app.quit();
      return;
    }
    target?.close();
  });
  ipcMain.handle("window:begin-drag", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target) beginWindowDrag(target);
  });
  ipcMain.handle("window:end-drag", () => {
    stopWindowDrag();
  });
  ipcMain.handle("window:set-mode", (_event, mode: "login" | "main") => {
    if (!mainWindow) return;
    if (mode === "main") {
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(1080, 720);
      mainWindow.setSize(1280, 820);
      mainWindow.center();
    } else {
      mainWindow.setResizable(false);
      mainWindow.setMinimumSize(380, 560);
      mainWindow.setSize(420, 620);
      mainWindow.center();
    }
  });
  ipcMain.handle("window:set-opacity", (_event, opacity: number) => {
    mainWindow?.setOpacity(Math.min(1, Math.max(0.7, opacity)));
  });
  ipcMain.handle("window:open-settings", (_event, token?: string | null) => {
    openUtilityWindow({ settingsWindow: "1" }, token, { width: 980, height: 640, title: "Chaq Settings" });
  });
  ipcMain.handle("window:open-profile", (event, payload?: string | null | { token?: string | null; anchor?: AnchorRect | null }) => {
    const token = typeof payload === "object" && payload ? payload.token : payload;
    const anchor = typeof payload === "object" && payload ? payload.anchor : null;
    const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const position = parent && anchor ? profilePopupPosition(parent, anchor, 300, 340) : {};
    openUtilityWindow({ profileWindow: "1" }, token, { width: 300, height: 340, title: "Chaq Profile", ...position });
  });
  ipcMain.handle("window:open-profile-edit", (_event, token?: string | null) => {
    openUtilityWindow({ profileEditWindow: "1" }, token, { width: 760, height: 560, title: "Chaq Edit Profile" });
  });
}

type AnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function openImageFile(): Promise<{ fileName: string; dataUrl: string } | null> {
  const options: OpenDialogOptions = {
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }
    ]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filePath = result.filePaths[0];
  const extension = filePath.split(".").pop()?.toLowerCase();
  const mimeType = extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp"
      ? "image/webp"
      : extension === "gif"
        ? "image/gif"
        : "image/png";
  const bytes = await readFile(filePath);
  return {
    fileName: filePath.split(/[\\/]/).pop() ?? "image",
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`
  };
}

function beginWindowDrag(target: BrowserWindow): void {
  stopWindowDrag();
  const cursor = screen.getCursorScreenPoint();
  const bounds = target.getBounds();
  dragTarget = target;
  dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  dragSize = { width: bounds.width, height: bounds.height };
  dragTimer = setInterval(() => {
    if (!dragTarget || dragTarget.isDestroyed()) {
      stopWindowDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    dragTarget.setBounds({
      x: Math.round(point.x - dragOffset.x),
      y: Math.round(point.y - dragOffset.y),
      width: dragSize.width,
      height: dragSize.height
    }, false);
  }, 16);
}

function stopWindowDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragTarget = null;
  dragSize = { width: 0, height: 0 };
}

function profilePopupPosition(parent: BrowserWindow, anchor: AnchorRect, width: number, height: number): { x: number; y: number } {
  const bounds = parent.getBounds();
  const rawX = bounds.x + Math.round(anchor.x) - 12;
  const rawY = bounds.y + Math.round(anchor.y) - 12;
  const display = screen.getDisplayMatching({ x: rawX, y: rawY, width, height }).workArea;
  return {
    x: Math.min(display.x + display.width - width, Math.max(display.x, rawX)),
    y: Math.min(display.y + display.height - height, Math.max(display.y, rawY))
  };
}

function openUtilityWindow(
  queryInput: Record<string, string>,
  token: string | null | undefined,
  options: { width: number; height: number; title: string; x?: number; y?: number }
): void {
  const utilityWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    x: options.x,
    y: options.y,
    minWidth: options.width,
    maxWidth: options.width,
    minHeight: options.height,
    maxHeight: options.height,
    resizable: false,
    frame: false,
    title: options.title,
    backgroundColor: "#111116",
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  hardenWindow(utilityWindow);
  const query = new URLSearchParams(queryInput);
  if (token) query.set("token", token);
  if (process.env.ELECTRON_RENDERER_URL) {
    void utilityWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${query.toString()}`);
  } else {
    void utilityWindow.loadFile(join(__dirname, "../renderer/index.html"), { query: Object.fromEntries(query.entries()) });
  }
}

function createCodec() {
  return {
    encrypt(value: string): string {
      if (safeStorage.isEncryptionAvailable()) {
        return `safe:${safeStorage.encryptString(value).toString("base64")}`;
      }
      return `plain:${Buffer.from(value, "utf8").toString("base64")}`;
    },
    decrypt(value: string): string {
      if (value.startsWith("safe:")) {
        return safeStorage.decryptString(Buffer.from(value.slice(5), "base64"));
      }
      if (value.startsWith("plain:")) {
        return Buffer.from(value.slice(6), "base64").toString("utf8");
      }
      return value;
    }
  };
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  localDb = await LocalDatabase.create(join(app.getPath("userData"), "chaq.db"), createCodec());
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (process.platform !== "darwin") {
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
