export type Id = string;

export type SkillVisibility = "private" | "public";
export type SkillSourceKind = "manual" | "wechat" | "qq" | "txt" | "csv" | "json" | "html" | "markdown";
export type DistillationStatus = "draft" | "confirmed" | "discarded";
export type MessageRole = "user" | "assistant" | "system";
export type ReactionTarget = "skill" | "comment";
export type ReactionValue = "up" | "down";
export type TokenTransactionKind = "recharge" | "cloud_model_usage" | "agent_model_usage" | "refund" | "admin_adjustment";
export type SkillAutoMessageMode = "fixed" | "random";
export type SkillAutoMessagePeriod = "day" | "week" | "month";
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

export interface SkillAutoMessageSettings {
  skillId: Id;
  enabled: boolean;
  mode: SkillAutoMessageMode;
  fixedPeriod: SkillAutoMessagePeriod;
  fixedCount: number;
  randomTokenLimit?: number | null;
  randomUnlimited: boolean;
  doNotDisturb: boolean;
  lastSyncedAt?: string | null;
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

export type AgentStatus = "draft" | "active" | "paused" | "archived";
export type AgentAutonomyMode = "manual" | "copilot" | "autonomous";
export type AgentVisibility = "private" | "unlisted" | "public";
export type AgentPostVisibility = "public" | "relationships" | "private";
export type AgentPresence = "thinking" | "online" | "away" | "offline";
export type AgentMemoryKind = "episodic" | "semantic" | "procedural" | "social" | "reflection";
export type AgentGoalStatus = "pending" | "active" | "blocked" | "completed" | "cancelled";
export type AgentTaskStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AgentRunTrigger = "user_message" | "agent_message" | "scheduled" | "goal" | "event" | "manual";
export type AgentRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type ParticipantKind = "user" | "agent" | "system";
export type ConversationKind = "human_agent" | "agent_agent" | "group" | "system";
export type AgentEventKind =
  | "observation"
  | "thought"
  | "plan"
  | "action"
  | "message"
  | "memory"
  | "goal"
  | "task"
  | "relationship"
  | "system"
  | "error";
export type RelationshipKind =
  | "owner"
  | "family"
  | "friend"
  | "partner"
  | "colleague"
  | "acquaintance"
  | "rival"
  | "mentor"
  | "mentee"
  | "custom";

export interface AgentIdentity {
  age?: string;
  gender?: string;
  location?: string;
  occupation?: string;
  background?: string;
  traits: string[];
  interests: string[];
  communicationStyle?: string;
}

export interface AgentDraft {
  name: string;
  handle: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  tagline: string;
  biography: string;
  profileStatus?: string;
  mood?: string;
  persona: string;
  tone: string;
  values: string[];
  worldview: string;
  boundaries: string;
  identity: AgentIdentity;
  tags: string[];
  autonomyMode: AgentAutonomyMode;
  visibility: AgentVisibility;
  modelProviderId?: string | null;
  model?: string | null;
  temperature: number;
  initiative: number;
  reflectionDepth: number;
  scheduleEveryMinutes: number;
  dailyTokenBudget: number;
  dailyActionBudget: number;
}

export interface AgentSummary extends AgentDraft {
  id: Id;
  ownerId: Id;
  legacySkillId?: Id | null;
  status: AgentStatus;
  presence: AgentPresence;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  tokensUsedToday: number;
  actionsUsedToday: number;
  activeGoalCount: number;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAgentSummary {
  id: Id;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  tagline: string;
  biography: string;
  profileStatus: string;
  mood: string;
  presence: AgentPresence;
  tags: string[];
  status: AgentStatus;
  autonomyMode: AgentAutonomyMode;
  updatedAt: string;
}

export interface AgentPostComment {
  id: Id;
  postId: Id;
  author: {
    id: Id;
    displayName: string;
    avatarUrl?: string | null;
  };
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPost {
  id: Id;
  agentId: Id;
  content: string;
  mediaUrls: string[];
  mood: string;
  location: string;
  visibility: AgentPostVisibility;
  pinned: boolean;
  reactionCount: number;
  commentCount: number;
  likedByViewer: boolean;
  comments: AgentPostComment[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  agent: PublicAgentSummary & {
    identity: AgentIdentity;
    values: string[];
    createdAt: string;
  };
  owner: {
    displayName: string;
    avatarUrl?: string | null;
  };
  isOwner: boolean;
  stats: {
    posts: number;
    relationships: number;
    conversations: number;
    daysActive: number;
  };
  posts: AgentPost[];
  recentActivity: Array<{
    id: Id;
    kind: AgentEventKind;
    title: string;
    createdAt: string;
  }>;
}

export interface AgentMemory {
  id: Id;
  agentId: Id;
  kind: AgentMemoryKind;
  content: string;
  summary: string;
  salience: number;
  confidence: number;
  emotionalValence: number;
  keywords: string[];
  sourceType?: string | null;
  sourceId?: string | null;
  accessCount: number;
  lastAccessedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentKnowledgeSource {
  id: Id;
  agentId: Id;
  kind: "note" | "file" | "chat_import" | "url" | "skill_migration";
  status: "processing" | "ready" | "failed";
  title: string;
  originUri?: string | null;
  summary: string;
  chunkCount: number;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRelationship {
  id: Id;
  sourceAgentId: Id;
  targetKind: ParticipantKind;
  targetId: Id;
  targetLabel: string;
  kind: RelationshipKind;
  customKind?: string | null;
  affinity: number;
  trust: number;
  familiarity: number;
  sentiment: number;
  interactionCount: number;
  notes: string;
  lastInteractionAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGoal {
  id: Id;
  agentId: Id;
  parentGoalId?: Id | null;
  title: string;
  description: string;
  status: AgentGoalStatus;
  priority: number;
  progress: number;
  success: string;
  dueAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: Id;
  agentId: Id;
  goalId?: Id | null;
  title: string;
  description: string;
  status: AgentTaskStatus;
  priority: number;
  scheduledFor?: string | null;
  toolName?: string | null;
  output?: unknown;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTool {
  id: Id;
  agentId: Id;
  name: string;
  kind: "builtin" | "http";
  description: string;
  enabled: boolean;
  riskLevel: "safe" | "confirm" | "external";
  config?: unknown;
  usageCount: number;
  lastUsedAt?: string | null;
}

export interface AgentRun {
  id: Id;
  agentId: Id;
  conversationId?: Id | null;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  plan?: unknown;
  outcome?: unknown;
  error?: string | null;
  promptTokens: number;
  completionTokens: number;
  chargedTokens: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface AgentEvent {
  id: Id;
  agentId: Id;
  runId?: Id | null;
  kind: AgentEventKind;
  title: string;
  content: string;
  data?: unknown;
  createdAt: string;
}

export interface AgentDetail extends AgentSummary {
  knowledgeSources: AgentKnowledgeSource[];
  memories: AgentMemory[];
  relationships: AgentRelationship[];
  goals: AgentGoal[];
  tasks: AgentTask[];
  tools: AgentTool[];
  recentRuns: AgentRun[];
  recentEvents: AgentEvent[];
}

export interface ConversationParticipant {
  id: Id;
  participantKind: ParticipantKind;
  participantId: Id;
  displayNameSnapshot: string;
  lastReadAt?: string | null;
  muted: boolean;
}

export interface ConversationMessage {
  id: Id;
  conversationId: Id;
  authorKind: ParticipantKind;
  authorId?: Id | null;
  kind: "text" | "system" | "action" | "summary";
  content: string;
  status: "pending" | "delivered" | "read" | "failed";
  replyToId?: Id | null;
  metadata?: unknown;
  createdAt: string;
}

export interface ConversationSummary {
  id: Id;
  kind: ConversationKind;
  title: string;
  participants: ConversationParticipant[];
  lastMessage?: ConversationMessage | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface AgentDashboard {
  agents: AgentSummary[];
  conversations: ConversationSummary[];
  activity: AgentEvent[];
  queuedRuns: number;
  runningRuns: number;
}
