export type Id = string;

export type SkillVisibility = "private" | "public";
export type SkillSourceKind = "manual" | "wechat" | "qq" | "txt" | "csv" | "json" | "html" | "markdown";
export type DistillationStatus = "draft" | "confirmed" | "discarded";
export type MessageRole = "user" | "assistant" | "system";
export type ReactionTarget = "skill" | "comment";
export type ReactionValue = "up" | "down";
export type TokenTransactionKind = "recharge" | "cloud_model_usage" | "refund" | "admin_adjustment";
export type ProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "dashscope"
  | "zhipu"
  | "ollama"
  | "custom";

export interface SkillDraft {
  name: string;
  avatarUrl?: string | null;
  description: string;
  persona: string;
  tone: string;
  knowledge: string;
  boundaries: string;
  examples: SkillExample[];
  tags: string[];
}

export interface SkillExample {
  user: string;
  assistant: string;
}

export interface SkillSummary extends SkillDraft {
  id: Id;
  ownerId: Id;
  visibility: SkillVisibility;
  activeVersionId?: Id | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionSnapshot extends SkillDraft {
  id: Id;
  skillId: Id;
  version: number;
  sourceKind: SkillSourceKind;
  status: DistillationStatus;
  createdAt: string;
}

export interface ImportedMessage {
  id: Id;
  speaker: string;
  content: string;
  timestamp?: string | null;
  selected: boolean;
}

export interface ImportPreview {
  sourceKind: SkillSourceKind;
  fileName: string;
  messages: ImportedMessage[];
  warnings: string[];
}

export interface ChatMessage {
  id: Id;
  skillId: Id;
  role: MessageRole;
  content: string;
  modelLabel?: string | null;
  createdAt: string;
}

export interface MarketplaceSkill {
  id: Id;
  skillId: Id;
  versionId: Id;
  publisherId: Id;
  name: string;
  description: string;
  avatarUrl?: string | null;
  tags: string[];
  upvotes: number;
  downvotes: number;
  favorites: number;
  importCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceComment {
  id: Id;
  marketplaceSkillId: Id;
  displayName: "匿名用户";
  content: string;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

export interface ModelProviderPublic {
  id: Id;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  models: ModelOption[];
  enabled: boolean;
  promptTokenPrice: number;
  completionTokenPrice: number;
  contextWindow: number;
}

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: number;
}

export interface UserModelConfigPublic {
  id: Id;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenTransaction {
  id: Id;
  userId: Id;
  kind: TokenTransactionKind;
  amount: number;
  balanceAfter: number;
  note?: string | null;
  createdAt: string;
}

export interface CloudChatRequest {
  providerId: Id;
  model: string;
  skill: SkillDraft;
  messages: Pick<ChatMessage, "role" | "content">[];
}

export interface CloudChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  chargedTokens: number;
  balanceAfter: number;
  modelLabel: string;
}

export interface DistillRequest {
  providerId?: Id;
  model?: string;
  sourceKind: SkillSourceKind;
  messages: ImportedMessage[];
  preferredName?: string;
}

export interface DistillResponse {
  draft: SkillDraft;
  promptTokens?: number;
  completionTokens?: number;
  balanceAfter?: number;
}
