import type {
  AgentDetail,
  AgentContact,
  AgentDraft,
  AgentEvent,
  AgentGoal,
  AgentMemory,
  AgentPost,
  AgentProfile,
  AgentRelationship,
  AgentRun,
  AgentSummary,
  AgentKnowledgeSearchResponse,
  AgentReviewItem,
  PublicAgentSummary,
  CloudChatRequest,
  CloudChatResponse,
  DistillRequest,
  DistillResponse,
  MarketplaceComment,
  MarketplaceSkill,
  ModelProviderPublic,
  SkillReviewItem,
  SkillDraft,
  SkillSummary,
  SkillVersionSnapshot,
  TokenTransaction,
  WalletSummary,
  ConversationMessage,
  ConversationSummary
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
  notificationSound: boolean;
  iconFlash: boolean;
  localChatDataPath?: string | null;
  fileStoragePath?: string | null;
};

export type LoginUser = {
  id: string;
  username: string;
  email?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  tokenBalance: number;
  createdAt: string;
};

export function getServerUrl(): string {
  const stored = localStorage.getItem("chaq.serverUrl");
  if (!stored || /localhost:(4100|4010|8200|8020|4537)\b/.test(stored)) {
    return (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:24537/api";
  }
  return stored;
}

export function getRealtimeUrl(sessionToken: string): string {
  const url = new URL(getServerUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
  url.searchParams.set("token", sessionToken);
  return url.toString();
}

export function connectRealtime(onEvent: (event: { type: string; payload: unknown; at?: string }) => void): () => void {
  const sessionToken = sessionStorage.getItem("chaq.sessionToken") || localStorage.getItem("chaq.sessionToken");
  if (!sessionToken) return () => undefined;
  let closed = false;
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let retryAttempt = 0;
  const open = () => {
    if (closed) return;
    socket = new WebSocket(getRealtimeUrl(sessionToken));
    socket.onopen = () => {
      retryAttempt = 0;
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data));
        if (event?.type !== "realtime.heartbeat") onEvent(event);
      } catch {
        // Ignore malformed realtime frames.
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = () => {
      if (closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, retryAttempt));
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => open(), delay + Math.round(Math.random() * 500));
    };
  };
  open();
  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    socket?.close();
    socket = null;
  };
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
    throw new Error(formatApiError(data?.message, response.status));
  }
  return data as T;
}

function formatApiError(message: unknown, status: number): string {
  if (Array.isArray(message)) {
    return message.map(formatApiMessage).filter(Boolean).join("\n") || `请求失败（${status}）。`;
  }
  if (typeof message === "string") {
    return formatApiMessage(message);
  }
  return `请求失败（${status}）。`;
}

function formatApiMessage(message: string): string {
  const fieldMatch = message.match(/^([\w.]+):\s*(.+)$/);
  const field = fieldMatch?.[1] ?? "";
  const detail = fieldMatch?.[2] ?? message;
  const label = fieldLabel(field);

  if (/String must contain at least 1 character/i.test(detail)) {
    return `请输入${label}。`;
  }
  if (/Invalid email/i.test(detail)) {
    return "请输入有效的邮箱地址。";
  }
  if (/Required/i.test(detail)) {
    return `${label}不能为空。`;
  }
  if (/String must contain at most/i.test(detail)) {
    return `${label}太长了，请缩短后再试。`;
  }
  return message;
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    username: "账号",
    password: "密码",
    confirmPassword: "确认密码",
    email: "邮箱",
    code: "验证码"
  };
  return labels[field] ?? "内容";
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
  requestRegisterCode: (payload: { email: string }) => request<{ ok: true }>("/auth/register/code", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  register: (payload: { email: string; password: string; confirmPassword: string; code: string }) => request<{
    sessionToken: string;
    expiresAt: string;
    user: LoginUser;
    settings: UserSettings;
  }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  logout: () => request<{ ok: true }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  }),
  me: () => request<LoginUser & { settings?: UserSettings }>("/users/me"),
  saveMe: (payload: {
    displayName?: string;
    avatarUrl?: string | null;
    email?: string;
    emailCode?: string;
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }) => request<LoginUser>("/users/me", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  requestProfileEmailCode: (payload: { email: string }) => request<{ ok: true }>("/users/me/email-code", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  settings: () => request<UserSettings>("/users/me/settings"),
  saveSettings: (payload: Partial<UserSettings>) => request<UserSettings>("/users/me/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  tokenLedger: () => request<TokenTransaction[]>("/users/me/tokens"),
  wallet: () => request<WalletSummary>("/users/me/wallet"),
  recharge: (payload: { amount: number; unit: "token" | "k" | "m"; note?: string }) => request<{
    user: LoginUser;
    transaction: TokenTransaction;
  }>("/users/me/recharge", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  providers: () => request<ModelProviderPublic[]>("/models/providers"),
  availableProviders: () => request<ModelProviderPublic[]>("/models/available"),
  privateProviders: () => request<ModelProviderPublic[]>("/models/private/providers"),
  savePrivateProvider: (payload: unknown) => request<ModelProviderPublic>("/models/private/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  deletePrivateProvider: (id: string) => request<{ ok: true }>(`/models/private/providers/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  testPrivateProvider: (payload: unknown) => request<{ ok: true; message: string }>("/models/private/test", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
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
  skills: () => request<SkillSummary[]>("/skills"),
  skill: (id: string) => request<SkillSummary>(`/skills/${id}`),
  createSkill: (skill: SkillDraft, sourceKind = "manual") => request<SkillSummary>("/skills", {
    method: "POST",
    body: JSON.stringify({ skill, sourceKind })
  }),
  saveSkill: (id: string, skill: SkillDraft, sourceKind = "manual") => request<SkillSummary>(`/skills/${id}`, {
    method: "POST",
    body: JSON.stringify({ skill, sourceKind })
  }),
  deleteSkill: (id: string) => request<{ ok: true }>(`/skills/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  skillVersions: (id: string) => request<SkillVersionSnapshot[]>(`/skills/${id}/versions`),
  logSource: (payload: unknown) => request("/skills/sources", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  reportSkill: (id: string, reason: string) => request<{ ok: true }>(`/skills/${id}/report`, {
    method: "POST",
    body: JSON.stringify({ reason })
  }),
  adminSkillReports: () => request<SkillReviewItem[]>("/skills/admin/reports"),
  moderateSkill: (skillId: string, action: "dismiss" | "unpublish" | "archive", note?: string) => request<{ ok: true }>(`/skills/admin/reports/${skillId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, note: note ?? "" })
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
  reportMarketplaceSkill: (id: string, reason: string) => request<{ ok: true }>(`/marketplace/${id}/report`, {
    method: "POST",
    body: JSON.stringify({ reason })
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
  }),
  agents: () => request<AgentSummary[]>("/agents"),
  agentContacts: () => request<AgentContact[]>("/agents/contacts"),
  addAgentContact: (id: string) => request<AgentContact>(`/agents/${id}/contact`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  removeAgentContact: (id: string) => request<{ ok: true }>(`/agents/${id}/contact/remove`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  discoverAgents: (query?: string) => request<PublicAgentSummary[]>(`/agents/discover${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  agent: (id: string) => request<AgentDetail>(`/agents/${id}`),
  agentProfile: (id: string) => request<AgentProfile>(`/agents/${id}/profile`),
  createAgent: (payload: AgentDraft) => request<AgentDetail>("/agents", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateAgent: (id: string, payload: Partial<AgentDraft> & { status?: AgentSummary["status"] }) => request<AgentDetail>(`/agents/${id}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  migrateSkillToAgent: (skillId: string) => request<AgentDetail>(`/agents/migrate-skill/${skillId}`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  addAgentMemory: (agentId: string, payload: unknown) => request<AgentMemory>(`/agents/${agentId}/memories`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  createAgentPost: (agentId: string, payload: unknown) => request<AgentPost>(`/agents/${agentId}/posts`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  deleteAgentPost: (agentId: string, postId: string) => request<{ ok: true }>(`/agents/${agentId}/posts/${postId}/delete`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  toggleAgentPostLike: (postId: string) => request<AgentPost>(`/agents/posts/${postId}/like`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  commentAgentPost: (postId: string, content: string) => request<AgentPost>(`/agents/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content })
  }),
  addAgentRelationship: (agentId: string, payload: unknown) => request<AgentRelationship>(`/agents/${agentId}/relationships`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  addAgentGoal: (agentId: string, payload: unknown) => request<AgentGoal>(`/agents/${agentId}/goals`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateAgentGoal: (agentId: string, goalId: string, payload: unknown) => request<AgentGoal>(`/agents/${agentId}/goals/${goalId}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  addAgentTask: (agentId: string, payload: unknown) => request(`/agents/${agentId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateAgentTask: (agentId: string, taskId: string, payload: unknown) => request(`/agents/${agentId}/tasks/${taskId}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateAgentTool: (agentId: string, toolId: string, payload: unknown) => request(`/agents/${agentId}/tools/${toolId}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  addAgentTool: (agentId: string, payload: unknown) => request(`/agents/${agentId}/tools`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  addAgentKnowledge: (agentId: string, payload: unknown) => request<{ id: string; chunkCount: number }>(`/agents/${agentId}/knowledge`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  searchAgentKnowledge: (agentId: string, payload: { query: string; limit?: number }) => request<AgentKnowledgeSearchResponse>(`/agents/${agentId}/knowledge/search`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  reindexAgentKnowledge: (agentId: string, sourceId: string) => request<{ id: string; chunkCount: number }>(`/agents/${agentId}/knowledge/${sourceId}/reindex`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  reportAgent: (agentId: string, reason: string) => request<{ ok: true }>(`/agents/${agentId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason })
  }),
  adminAgentReports: () => request<AgentReviewItem[]>("/agents/admin/reports"),
  moderateAgent: (agentId: string, action: "dismiss" | "unpublish" | "archive", note?: string) => request<{ ok: true }>(`/agents/admin/reports/${agentId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, note: note ?? "" })
  }),
  runAgent: (agentId: string, conversationId?: string) => request<AgentRun>(`/agents/${agentId}/run`, {
    method: "POST",
    body: JSON.stringify({ conversationId })
  }),
  agentActivity: (agentId?: string) => request<AgentEvent[]>(`/agents/activity${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`),
  conversations: () => request<ConversationSummary[]>("/conversations"),
  conversationWithAgent: (agentId: string) => request<ConversationSummary>(`/conversations/with-agent/${agentId}`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  conversationMessages: (id: string) => request<ConversationMessage[]>(`/conversations/${id}/messages`),
  sendConversationMessage: (id: string, content: string, replyToId?: string) => request<ConversationMessage>(`/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, replyToId })
  }),
  markConversationRead: (id: string) => request<{ ok: true }>(`/conversations/${id}/read`, {
    method: "POST",
    body: JSON.stringify({})
  })
};
