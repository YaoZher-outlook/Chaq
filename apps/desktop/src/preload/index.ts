import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatMessage,
  SkillAutoMessageSettings,
  SkillDraft,
  SkillSourceKind,
  SkillSummary,
  SkillVersionSnapshot
} from "@chaq/shared";

const api = {
  skills: {
    list: (): Promise<SkillSummary[]> => ipcRenderer.invoke("skills:list"),
    get: (id: string): Promise<SkillSummary | null> => ipcRenderer.invoke("skills:get", id),
    cache: (skills: SkillSummary[]): Promise<void> => ipcRenderer.invoke("skills:cache", skills),
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
    openImage: (): Promise<{ fileName: string; dataUrl: string } | null> => ipcRenderer.invoke("files:open-image")
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
    setMode: (mode: "login" | "main"): Promise<void> => ipcRenderer.invoke("window:set-mode", mode),
    setOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke("window:set-opacity", opacity),
    flashFrame: (enabled: boolean): Promise<void> => ipcRenderer.invoke("window:flash-frame", enabled),
    openSettings: (token?: string | null): Promise<void> => ipcRenderer.invoke("window:open-settings", token),
    openProfile: (
      token?: string | null,
      anchor?: { x: number; y: number; width: number; height: number } | null
    ): Promise<void> => ipcRenderer.invoke("window:open-profile", { token, anchor }),
    openProfileEdit: (token?: string | null): Promise<void> => ipcRenderer.invoke("window:open-profile-edit", token)
  },
  auth: {
    broadcastLogout: (): Promise<void> => ipcRenderer.invoke("auth:broadcast-logout"),
    consumeWindowBootstrap: (): Promise<string | null> => ipcRenderer.invoke("auth:consume-window-bootstrap"),
    saveRememberedSession: (payload: { accountId: string; sessionToken: string; expiresAt: string }): Promise<void> =>
      ipcRenderer.invoke("auth:remembered-session:save", payload),
    getRememberedSession: (accountId: string): Promise<{ accountId: string; sessionToken: string; expiresAt: string } | null> =>
      ipcRenderer.invoke("auth:remembered-session:get", accountId),
    deleteRememberedSession: (accountId: string): Promise<void> =>
      ipcRenderer.invoke("auth:remembered-session:delete", accountId),
    onLoggedOut: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on("auth:logged-out", listener);
      return () => ipcRenderer.removeListener("auth:logged-out", listener);
    }
  }
};

contextBridge.exposeInMainWorld("chaq", api);

export type ChaqApi = typeof api;
