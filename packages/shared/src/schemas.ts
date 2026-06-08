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
  avatarUrl: z.string().url().optional().nullable(),
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
