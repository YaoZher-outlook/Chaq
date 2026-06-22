import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatMessage,
  SkillAutoMessageSettings,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  SkillVersionSnapshot,
  UserModelConfigPublic
} from "@chaq/shared";

const api = {
  skills: {
    list: (): Promise<SkillSummary[]> => ipcRenderer.invoke("skills:list"),
    get: (id: string): Promise<SkillSummary | null> => ipcRenderer.invoke("skills:get", id),
    create: (skill: SkillDraft, sourceKind?: SkillSourceKind, id?: string): Promise<SkillSummary> =>
      ipcRenderer.invoke("skills:create", { skill, sourceKind, id }),
    update: (id: string, skill: SkillDraft, sourceKind?: SkillSourceKind): Promise<SkillSummary> =>
      ipcRenderer.invoke("skills:update", { id, skill, sourceKind }),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("skills:delete", id),
    versions: (skillId: string): Promise<SkillVersionSnapshot[]> => ipcRenderer.invoke("skills:versions", skillId),
    getAutoSettings: (skillId: string): Promise<SkillAutoMessageSettings> =>
      ipcRenderer.invoke("skills:auto-settings:get", skillId),
    saveAutoSettings: (settings: SkillAutoMessageSettings): Promise<SkillAutoMessageSettings> =>
      ipcRenderer.invoke("skills:auto-settings:save", settings)
  },
  messages: {
    list: (skillId: string): Promise<ChatMessage[]> => ipcRenderer.invoke("messages:list", skillId),
    add: (payload: {
      skillId: string;
      role: ChatMessage["role"];
      content: string;
      modelLabel?: string | null;
    }): Promise<ChatMessage> => ipcRenderer.invoke("messages:add", payload),
    clear: (skillId: string): Promise<void> => ipcRenderer.invoke("messages:clear", skillId)
  },
  imports: {
    openFile: (): Promise<{ filePath: string; fileName: string; content: string } | null> => ipcRenderer.invoke("imports:open-file"),
    save: (payload: {
      sourceKind: SkillSourceKind;
      fileName: string;
      messages: unknown[];
      warnings: string[];
      draft?: SkillDraft | null;
    }) => ipcRenderer.invoke("imports:save", payload)
  },
  files: {
    openBackgroundImage: (): Promise<{ fileName: string; dataUrl: string } | null> => ipcRenderer.invoke("files:open-background-image"),
    openImage: (): Promise<{ fileName: string; dataUrl: string } | null> => ipcRenderer.invoke("files:open-image"),
    openFolder: (): Promise<string | null> => ipcRenderer.invoke("files:open-folder")
  },
  models: {
    listUser: (userId?: string): Promise<UserModelConfigPublic[]> => ipcRenderer.invoke("models:list-user", userId),
    saveUser: (payload: {
      userId?: string;
      id?: string;
      kind: UserModelConfigPublic["kind"];
      name: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
    }): Promise<UserModelConfigPublic> => ipcRenderer.invoke("models:save-user", payload),
    deleteUser: (id: string, userId?: string): Promise<void> => ipcRenderer.invoke("models:delete-user", { id, userId }),
    testUser: (payload: {
      kind: UserModelConfigPublic["kind"];
      name?: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
    }): Promise<{
      ok: boolean;
      kind: UserModelConfigPublic["kind"];
      name: string;
      baseUrl: string;
      defaultModel: string;
      message: string;
      modelCount?: number;
      suggestedModel?: string;
    }> => ipcRenderer.invoke("models:test-user", payload),
    detectUserProvider: (apiKey: string): Promise<{
      ok: boolean;
      kind: UserModelConfigPublic["kind"];
      name: string;
      baseUrl: string;
      defaultModel: string;
      message: string;
      modelCount?: number;
      suggestedModel?: string;
    }> => ipcRenderer.invoke("models:detect-user-provider", apiKey),
    userChat: (payload: {
      userId?: string;
      configId: string;
      skill: SkillDraft;
      messages: Pick<ChatMessage, "role" | "content">[];
    }): Promise<{ content: string; modelLabel: string }> => ipcRenderer.invoke("models:user-chat", payload)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
    beginDrag: (): Promise<void> => ipcRenderer.invoke("window:begin-drag"),
    endDrag: (): Promise<void> => ipcRenderer.invoke("window:end-drag"),
    setMode: (mode: "login" | "main"): Promise<void> => ipcRenderer.invoke("window:set-mode", mode),
    setOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke("window:set-opacity", opacity),
    openSettings: (token?: string | null): Promise<void> => ipcRenderer.invoke("window:open-settings", token),
    openProfile: (
      token?: string | null,
      anchor?: { x: number; y: number; width: number; height: number } | null
    ): Promise<void> => ipcRenderer.invoke("window:open-profile", { token, anchor }),
    openProfileEdit: (token?: string | null): Promise<void> => ipcRenderer.invoke("window:open-profile-edit", token)
  }
};

contextBridge.exposeInMainWorld("chaq", api);

export type ChaqApi = typeof api;
