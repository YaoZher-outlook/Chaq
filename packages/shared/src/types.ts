export type Id = string;

export type SkillVisibility = "private" | "public";
export type SkillSourceKind = "manual" | "wechat" | "qq" | "txt" | "csv" | "json" | "html" | "markdown";
export type DistillationStatus = "draft" | "confirmed" | "discarded";
export type MessageRole = "user" | "assistant" | "system";
export type ReactionTarget = "skill" | "comment";
export type ReactionValue = "up" | "down";
export type TokenTransactionKind = "recharge" | "cloud_model_usage" | "agent_model_usage" | "agent_service_fee" | "agent_service_earning" | "refund" | "admin_adjustment";
export type RechargeOrderStatus = "pending" | "submitted" | "paid" | "rejected" | "cancelled" | "expired";
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
export type ModelProviderScope = "platform" | "user_private";

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
  displayName: string;
  content: string;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

export type SkillReportStatus = "pending" | "dismissed" | "actioned";

export interface SkillReviewItem {
  skill: MarketplaceSkill & {
    ownerId: Id;
    ownerDisplayName: string;
    visibility: SkillVisibility;
  };
  reportCount: number;
  latestReason: string;
  latestReporter: string;
  oldestReportAt: string;
  latestReportAt: string;
  status: SkillReportStatus;
}

export interface ModelProviderPublic {
  id: Id;
  scope: ModelProviderScope;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  models: ModelOption[];
  embeddingModel?: string | null;
  embeddingTokenPrice: number;
  enabled: boolean;
  promptTokenPrice: number;
  completionTokenPrice: number;
  contextWindow: number;
}

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: number;
  embeddingModel?: string;
  embeddingTokenPrice?: number;
}

export interface UserModelConfigPublic {
  id: Id;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string;
  embeddingModel?: string | null;
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

export interface RechargePaymentAccount {
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  accountNumber?: string;
}

export interface RechargeOrder {
  id: Id;
  orderNo: string;
  userId: Id;
  status: RechargeOrderStatus;
  amountTokens: number;
  requestedAmount: number;
  requestedUnit: "token" | "k" | "m";
  payableCny: number;
  paymentMethod: "bank_transfer";
  paymentReference: string;
  paymentAccount?: RechargePaymentAccount;
  payerNote?: string | null;
  adminNote?: string | null;
  paidTransactionId?: Id | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RechargeConfig {
  enabled: boolean;
  allowed: boolean;
  allowedUsername: string;
  cnyPerMToken: number;
  minMToken: number;
  maxMToken: number;
  orderExpiresMinutes: number;
  paymentAccount?: RechargePaymentAccount;
}

export interface AdminRechargeOrder extends RechargeOrder {
  user: {
    id: Id;
    username: string;
    email?: string | null;
    displayName: string;
  };
}

export interface WalletSummary {
  balance: number;
  totalSpent: number;
  modelSpent: number;
  serviceFeesPaid: number;
  serviceEarnings: number;
  agentEarnings: Array<{
    agentId: Id;
    agentName: string;
    amount: number;
    transactionCount: number;
  }>;
  transactions: TokenTransaction[];
  rechargeOrders: RechargeOrder[];
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
export type AgentReportStatus = "pending" | "dismissed" | "actioned";
export type AgentMemoryKind = "episodic" | "semantic" | "procedural" | "social" | "reflection";
export type AgentKnowledgeSourceKind = "note" | "file" | "chat_import" | "url" | "skill_migration";
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
  serviceFee: number;
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
  serviceFee: number;
  isContact?: boolean;
  updatedAt: string;
}

export interface AgentReviewItem {
  agent: PublicAgentSummary & {
    ownerId: Id;
    ownerDisplayName: string;
  };
  reportCount: number;
  latestReason: string;
  latestReporter: string;
  oldestReportAt: string;
  latestReportAt: string;
  status: AgentReportStatus;
}

export interface AgentContact {
  id: Id;
  agent: PublicAgentSummary;
  alias?: string | null;
  muted: boolean;
  createdAt: string;
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
  isContact: boolean;
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
  kind: AgentKnowledgeSourceKind;
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

export interface AgentKnowledgeSearchResult {
  id: Id;
  sourceId: Id;
  sourceTitle: string;
  sourceKind: AgentKnowledgeSourceKind;
  position: number;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
  keywords: string[];
  embeddingModel?: string | null;
}

export interface AgentKnowledgeSearchResponse {
  query: string;
  queryEmbeddingModel: string;
  queryUsedFallback: boolean;
  promptTokens: number;
  chargedTokens: number;
  resultCount: number;
  results: AgentKnowledgeSearchResult[];
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
