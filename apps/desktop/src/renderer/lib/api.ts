import type {
  CloudChatRequest,
  CloudChatResponse,
  DistillRequest,
  DistillResponse,
  MarketplaceComment,
  MarketplaceSkill,
  ModelProviderPublic,
  SkillDraft,
  TokenTransaction
} from "@chaq/shared";

export type UserRole = "USER" | "CREATOR" | "ADMIN";

export type UserSettings = {
  id: string;
  userId: string;
  language: "zh" | "en";
  theme: "light" | "dark" | "system";
  backgroundUrl?: string | null;
  backgroundOpacity: number;
  windowOpacity: number;
};

export type LoginUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  tokenBalance: number;
  createdAt: string;
};

export function getServerUrl(): string {
  const stored = localStorage.getItem("chaq.serverUrl");
  if (!stored || /localhost:(4100|4010|8200|8020)\b/.test(stored)) {
    return "http://localhost:4537/api";
  }
  return stored;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionToken = sessionStorage.getItem("chaq.sessionToken") || localStorage.getItem("chaq.sessionToken");
  const response = await fetch(`${getServerUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...init?.headers
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(Array.isArray(data?.message) ? data.message.join("\n") : data?.message ?? `HTTP ${response.status}`);
  }
  return data as T;
}

export const api = {
  login: (payload: { username: string; password: string }) => request<{
    sessionToken: string;
    expiresAt: string;
    user: LoginUser;
    settings: UserSettings;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  logout: () => request<{ ok: true }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  }),
  me: () => request<LoginUser & { settings?: UserSettings }>("/users/me"),
  settings: () => request<UserSettings>("/users/me/settings"),
  saveSettings: (payload: Partial<UserSettings>) => request<UserSettings>("/users/me/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  tokenLedger: () => request<TokenTransaction[]>("/users/me/tokens"),
  providers: () => request<ModelProviderPublic[]>("/models/providers"),
  adminProviders: () => request<ModelProviderPublic[]>("/models/admin/providers"),
  saveProvider: (payload: unknown) => request<ModelProviderPublic>("/models/admin/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  setProviderStatus: (id: string, enabled: boolean) => request<ModelProviderPublic>(`/models/admin/providers/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ enabled })
  }),
  cloudChat: (payload: CloudChatRequest) => request<CloudChatResponse>("/models/cloud/chat", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  distill: (payload: DistillRequest) => request<DistillResponse>("/skills/distill", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  logSource: (payload: unknown) => request("/skills/sources", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  marketplace: (query?: string) => request<MarketplaceSkill[]>(`/marketplace${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  publish: (skill: SkillDraft, sourceKind = "manual") => request<MarketplaceSkill>("/marketplace/publish", {
    method: "POST",
    body: JSON.stringify({ skill, sourceKind })
  }),
  importMarketplaceSkill: (id: string) => request<{ sourceMarketplaceSkillId: string; skill: SkillDraft }>(`/marketplace/${id}/import`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  reactSkill: (id: string, value: "up" | "down") => request<MarketplaceSkill>(`/marketplace/${id}/reaction`, {
    method: "POST",
    body: JSON.stringify({ value })
  }),
  favorite: (id: string) => request<{ favorited: boolean }>(`/marketplace/${id}/favorite`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  comments: (id: string) => request<MarketplaceComment[]>(`/marketplace/${id}/comments`),
  addComment: (id: string, content: string) => request<MarketplaceComment>(`/marketplace/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ content })
  }),
  reactComment: (id: string, value: "up" | "down") => request<MarketplaceComment>(`/marketplace/comments/${id}/reaction`, {
    method: "POST",
    body: JSON.stringify({ value })
  })
};
