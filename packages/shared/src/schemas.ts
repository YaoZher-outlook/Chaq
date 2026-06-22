import { z } from "zod";

export const providerKinds = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "dashscope",
  "zhipu",
  "ollama",
  "custom"
] as const;

export const skillSourceKinds = ["manual", "wechat", "qq", "txt", "csv", "json", "html", "markdown"] as const;

export const skillExampleSchema = z.object({
  user: z.string().min(1).max(1000),
  assistant: z.string().min(1).max(2000)
});

export const skillDraftSchema = z.object({
  name: z.string().min(1).max(60),
  avatarUrl: z.string().max(8_000_000).optional().nullable(),
  description: z.string().min(1).max(300),
  persona: z.string().min(1).max(8000),
  tone: z.string().min(1).max(2000),
  knowledge: z.string().max(12000),
  boundaries: z.string().max(4000),
  examples: z.array(skillExampleSchema).max(8),
  tags: z.array(z.string().min(1).max(24)).max(8)
});

export const importedMessageSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1).max(80),
  content: z.string().min(1).max(8000),
  timestamp: z.string().optional().nullable(),
  selected: z.boolean()
});

export const distillRequestSchema = z.object({
  providerId: z.string().optional(),
  model: z.string().optional(),
  sourceKind: z.enum(skillSourceKinds),
  messages: z.array(importedMessageSchema).min(1).max(2000),
  preferredName: z.string().max(60).optional()
});

export const cloudChatRequestSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  skill: skillDraftSchema,
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(12000)
      })
    )
    .min(1)
    .max(60)
});

export const userModelConfigSchema = z.object({
  kind: z.enum(providerKinds),
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(1).max(300),
  apiKey: z.string().max(5000).optional(),
  defaultModel: z.string().min(1).max(120)
});

export const providerConfigSchema = z.object({
  kind: z.enum(providerKinds),
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(1).max(300),
  apiKey: z.string().min(1).max(5000),
  models: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        label: z.string().min(1).max(120),
        contextWindow: z.number().int().positive()
      })
    )
    .min(1),
  enabled: z.boolean(),
  promptTokenPrice: z.number().nonnegative(),
  completionTokenPrice: z.number().nonnegative(),
  contextWindow: z.number().int().positive()
});

export const agentStatuses = ["draft", "active", "paused", "archived"] as const;
export const agentAutonomyModes = ["manual", "copilot", "autonomous"] as const;
export const agentVisibilities = ["private", "unlisted", "public"] as const;
export const agentPostVisibilities = ["public", "relationships", "private"] as const;
export const agentMemoryKinds = ["episodic", "semantic", "procedural", "social", "reflection"] as const;
export const agentGoalStatuses = ["pending", "active", "blocked", "completed", "cancelled"] as const;
export const participantKinds = ["user", "agent", "system"] as const;
export const relationshipKinds = [
  "owner",
  "family",
  "friend",
  "partner",
  "colleague",
  "acquaintance",
  "rival",
  "mentor",
  "mentee",
  "custom"
] as const;

export const agentIdentitySchema = z.object({
  age: z.string().max(40).optional(),
  gender: z.string().max(40).optional(),
  location: z.string().max(120).optional(),
  occupation: z.string().max(120).optional(),
  background: z.string().max(4000).optional(),
  traits: z.array(z.string().min(1).max(60)).max(20).default([]),
  interests: z.array(z.string().min(1).max(80)).max(30).default([]),
  communicationStyle: z.string().max(1000).optional()
});

export const agentDraftSchema = z.object({
  name: z.string().min(1).max(80),
  handle: z.string().min(2).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  avatarUrl: z.string().max(8_000_000).optional().nullable(),
  coverUrl: z.string().max(8_000_000).optional().nullable(),
  tagline: z.string().max(200).default(""),
  biography: z.string().max(8000).default(""),
  profileStatus: z.string().max(160).default(""),
  mood: z.string().max(80).default(""),
  persona: z.string().min(1).max(12000),
  tone: z.string().min(1).max(3000),
  values: z.array(z.string().min(1).max(80)).max(20).default([]),
  worldview: z.string().max(6000).default(""),
  boundaries: z.string().max(6000).default(""),
  identity: agentIdentitySchema,
  tags: z.array(z.string().min(1).max(32)).max(12).default([]),
  autonomyMode: z.enum(agentAutonomyModes).default("copilot"),
  visibility: z.enum(agentVisibilities).default("private"),
  modelProviderId: z.string().optional().nullable(),
  model: z.string().max(160).optional().nullable(),
  temperature: z.number().min(0).max(2).default(0.7),
  initiative: z.number().int().min(0).max(100).default(55),
  reflectionDepth: z.number().int().min(0).max(5).default(2),
  scheduleEveryMinutes: z.number().int().min(5).max(10080).default(60),
  dailyTokenBudget: z.number().int().min(0).max(2_000_000).default(5000),
  dailyActionBudget: z.number().int().min(0).max(1000).default(30)
});

export const agentUpdateSchema = agentDraftSchema.partial().extend({
  status: z.enum(agentStatuses).optional()
});

export const agentMemoryInputSchema = z.object({
  kind: z.enum(agentMemoryKinds).default("semantic"),
  content: z.string().min(1).max(20000),
  summary: z.string().max(2000).default(""),
  salience: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.8),
  emotionalValence: z.number().min(-1).max(1).default(0),
  keywords: z.array(z.string().min(1).max(80)).max(30).default([]),
  sourceType: z.string().max(80).optional(),
  sourceId: z.string().max(160).optional()
});

export const agentRelationshipInputSchema = z.object({
  targetKind: z.enum(participantKinds),
  targetId: z.string().min(1).max(160),
  targetLabel: z.string().min(1).max(120),
  kind: z.enum(relationshipKinds).default("acquaintance"),
  customKind: z.string().max(80).optional().nullable(),
  affinity: z.number().min(-1).max(1).default(0),
  trust: z.number().min(0).max(1).default(0.5),
  familiarity: z.number().min(0).max(1).default(0),
  sentiment: z.number().min(-1).max(1).default(0),
  notes: z.string().max(4000).default("")
});

export const agentGoalInputSchema = z.object({
  parentGoalId: z.string().optional().nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  status: z.enum(agentGoalStatuses).default("pending"),
  priority: z.number().int().min(0).max(100).default(50),
  progress: z.number().min(0).max(1).default(0),
  success: z.string().max(2000).default(""),
  dueAt: z.string().datetime().optional().nullable()
});

export const agentGoalUpdateSchema = agentGoalInputSchema.partial();

export const agentTaskInputSchema = z.object({
  goalId: z.string().optional().nullable(),
  title: z.string().min(1).max(240),
  description: z.string().max(5000).default(""),
  priority: z.number().int().min(0).max(100).default(50),
  scheduledFor: z.string().datetime().optional().nullable()
});

export const agentTaskUpdateSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"]).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  scheduledFor: z.string().datetime().optional().nullable()
});

export const agentToolUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  riskLevel: z.enum(["safe", "confirm", "external"]).optional(),
  config: z.record(z.unknown()).optional().nullable(),
  permissions: z.record(z.unknown()).optional().nullable()
});

export const agentKnowledgeInputSchema = z.object({
  kind: z.enum(["note", "file", "chat_import", "url", "skill_migration"]).default("note"),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(2_000_000),
  originUri: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

export const agentPostInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  mediaUrls: z.array(z.string().max(8_000_000)).max(4).default([]),
  mood: z.string().max(80).default(""),
  location: z.string().max(120).default(""),
  visibility: z.enum(agentPostVisibilities).default("public")
});

export const agentPostCommentInputSchema = z.object({
  content: z.string().trim().min(1).max(1000)
});

export const conversationMessageInputSchema = z.object({
  content: z.string().min(1).max(30000),
  replyToId: z.string().optional().nullable()
});
