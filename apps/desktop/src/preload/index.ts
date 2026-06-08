import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatMessage,
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
    create: (skill: SkillDraft, sourceKind?: SkillSourceKind): Promise<SkillSummary> =>
      ipcRenderer.invoke("skills:create", { skill, sourceKind }),
    update: (id: string, skill: SkillDraft, sourceKind?: SkillSourceKind): Promise<SkillSummary> =>
      ipcRenderer.invoke("skills:update", { id, skill, sourceKind }),
    versions: (skillId: string): Promise<SkillVersionSnapshot[]> => ipcRenderer.invoke("skills:versions", skillId)
  },
  messages: {
    list: (skillId: string): Promise<ChatMessage[]> => ipcRenderer.invoke("messages:list", skillId),
    add: (payload: {
      skillId: string;
      role: ChatMessage["role"];
      content: string;
      modelLabel?: string | null;
    }): Promise<ChatMessage> => ipcRenderer.invoke("messages:add", payload)
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
  models: {
    listUser: (): Promise<UserModelConfigPublic[]> => ipcRenderer.invoke("models:list-user"),
    saveUser: (payload: {
      id?: string;
      kind: UserModelConfigPublic["kind"];
      name: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
    }): Promise<UserModelConfigPublic> => ipcRenderer.invoke("models:save-user", payload),
    deleteUser: (id: string): Promise<void> => ipcRenderer.invoke("models:delete-user", id),
    userChat: (payload: {
      configId: string;
      skill: SkillDraft;
      messages: Pick<ChatMessage, "role" | "content">[];
    }): Promise<{ content: string; modelLabel: string }> => ipcRenderer.invoke("models:user-chat", payload)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
    setMode: (mode: "login" | "main"): Promise<void> => ipcRenderer.invoke("window:set-mode", mode),
    setOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke("window:set-opacity", opacity)
  }
};

contextBridge.exposeInMainWorld("chaq", api);

export type ChaqApi = typeof api;
