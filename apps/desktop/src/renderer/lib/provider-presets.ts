import type { ProviderKind } from "@chaq/shared";

export type ProviderPreset = {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string;
  embeddingModel: string;
  modelLabel: string;
  contextWindow: number;
};

export const providerKinds: ProviderKind[] = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "dashscope",
  "zhipu",
  "ollama",
  "custom"
];

export const userModelPresets: Record<ProviderKind, ProviderPreset> = {
  openai: {
    kind: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    embeddingModel: "text-embedding-3-small",
    modelLabel: "GPT 4.1 Mini",
    contextWindow: 128000
  },
  anthropic: {
    kind: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    embeddingModel: "",
    modelLabel: "Claude 3.5 Haiku",
    contextWindow: 200000
  },
  google: {
    kind: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-1.5-flash",
    embeddingModel: "text-embedding-004",
    modelLabel: "Gemini 1.5 Flash",
    contextWindow: 1000000
  },
  deepseek: {
    kind: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    embeddingModel: "",
    modelLabel: "DeepSeek Chat",
    contextWindow: 64000
  },
  dashscope: {
    kind: "dashscope",
    name: "阿里 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    embeddingModel: "text-embedding-v3",
    modelLabel: "Qwen Plus",
    contextWindow: 131072
  },
  zhipu: {
    kind: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    embeddingModel: "embedding-3",
    modelLabel: "GLM 4 Flash",
    contextWindow: 128000
  },
  ollama: {
    kind: "ollama",
    name: "Ollama 本地模型",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.1",
    embeddingModel: "nomic-embed-text",
    modelLabel: "Llama 3.1",
    contextWindow: 8192
  },
  custom: {
    kind: "custom",
    name: "自定义 OpenAI Compatible",
    baseUrl: "",
    defaultModel: "",
    embeddingModel: "",
    modelLabel: "",
    contextWindow: 128000
  }
};
