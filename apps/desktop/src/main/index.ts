import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import type { OpenDialogOptions } from "electron";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage, SkillDraft, SkillSourceKind } from "@chaq/shared";
import { LocalDatabase } from "./local-db";
import { callUserModel } from "./model-adapters";

let mainWindow: BrowserWindow | null = null;
let localDb: LocalDatabase;

const chaqEnvironmentRoot = join(process.env.CHAQ_ENV_ROOT || "E:\\Environment", "Chaq");
const chaqUserDataPath = join(chaqEnvironmentRoot, "user-data");

mkdirSync(chaqUserDataPath, { recursive: true });
app.setPath("userData", chaqUserDataPath);

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
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("skills:list", () => localDb.listSkills());
  ipcMain.handle("skills:get", (_event, id: string) => localDb.getSkill(id));
  ipcMain.handle("skills:create", (_event, payload: { skill: SkillDraft; sourceKind?: SkillSourceKind }) =>
    localDb.createSkill(payload.skill, payload.sourceKind)
  );
  ipcMain.handle("skills:update", (_event, payload: { id: string; skill: SkillDraft; sourceKind?: SkillSourceKind }) =>
    localDb.updateSkill(payload.id, payload.skill, payload.sourceKind)
  );
  ipcMain.handle("skills:versions", (_event, skillId: string) => localDb.listVersions(skillId));

  ipcMain.handle("messages:list", (_event, skillId: string) => localDb.listMessages(skillId));
  ipcMain.handle("messages:add", (_event, payload: { skillId: string; role: ChatMessage["role"]; content: string; modelLabel?: string | null }) =>
    localDb.addMessage(payload)
  );

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

  ipcMain.handle("models:list-user", () => localDb.listUserModelConfigs());
  ipcMain.handle("models:save-user", (_event, payload: Parameters<LocalDatabase["saveUserModelConfig"]>[0]) =>
    localDb.saveUserModelConfig(payload)
  );
  ipcMain.handle("models:delete-user", (_event, id: string) => localDb.deleteUserModelConfig(id));
  ipcMain.handle(
    "models:user-chat",
    async (
      _event,
      payload: {
        configId: string;
        skill: SkillDraft;
        messages: Pick<ChatMessage, "role" | "content">[];
      }
    ) => callUserModel(localDb.getSecretModelConfig(payload.configId), payload.skill, payload.messages)
  );

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
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

app.whenReady().then(async () => {
  localDb = await LocalDatabase.create(join(app.getPath("userData"), "chaq.db"), createCodec());
  registerIpc();
  createWindow();

  app.on("activate", () => {
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
