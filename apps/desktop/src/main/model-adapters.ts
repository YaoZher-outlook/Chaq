import type { ChatMessage, ProviderKind, SkillDraft, UserModelConfigPublic } from "@chaq/shared";

export type SecretModelConfig = UserModelConfigPublic & {
  apiKey: string;
};

export type UserModelTestInput = {
  kind: ProviderKind;
  name?: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

export type UserModelTestResult = {
  ok: boolean;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string;
  message: string;
  modelCount?: number;
  suggestedModel?: string;
};

const providerPresets: Array<{
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModel: string;
}> = [
  { kind: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  { kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { kind: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-haiku-latest" },
  { kind: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-1.5-flash" },
  { kind: "dashscope", name: "阿里 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  { kind: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" }
];

export async function callUserModel(
  config: SecretModelConfig,
  skill: SkillDraft,
  messages: Pick<ChatMessage, "role" | "content">[]
): Promise<{ content: string; modelLabel: string }> {
  const prepared = buildMessages(skill, messages);
  if (config.kind === "anthropic") {
    return callAnthropic(config, prepared);
  }
  if (config.kind === "google") {
    return callGoogle(config, prepared);
  }
  return callOpenAICompatible(config, prepared);
}

export async function testUserModelConfig(input: UserModelTestInput): Promise<UserModelTestResult> {
  const preset = providerPresets.find((item) => item.kind === input.kind);
  const name = input.name?.trim() || preset?.name || "自定义模型";
  const config = {
    kind: input.kind,
    name,
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    defaultModel: input.defaultModel.trim()
  };

  try {
    const models = await listModels(config);
    const suggestedModel = models.find((model) => model === config.defaultModel) ?? models[0];
    return {
      ok: true,
      kind: config.kind,
      name,
      baseUrl: config.baseUrl,
      defaultModel: suggestedModel || config.defaultModel,
      message: models.length ? `连接成功，读取到 ${models.length} 个模型。` : "连接成功。",
      modelCount: models.length,
      suggestedModel
    };
  } catch (error) {
    return {
      ok: false,
      kind: config.kind,
      name,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function detectUserModelProvider(apiKey: string): Promise<UserModelTestResult> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("请输入 API Key 后再检测。");
  }

  const likely = providerPresets
    .map((preset) => ({ preset, score: providerKeyScore(preset.kind, key) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.preset);

  let lastMessage = "";
  for (const preset of likely) {
    const result = await testUserModelConfig({
      ...preset,
      apiKey: key
    });
    if (result.ok) return result;
    lastMessage = result.message;
  }

  return {
    ok: false,
    kind: "custom",
    name: "自定义模型",
    baseUrl: "",
    defaultModel: "",
    message: lastMessage || "未能识别这个 API Key，请手动选择厂商并检查接口地址。"
  };
}

function buildMessages(skill: SkillDraft, messages: Pick<ChatMessage, "role" | "content">[]) {
  return [
    {
      role: "system",
      content: [
        `你正在扮演 Chaq skill：${skill.name}`,
        `简介：${skill.description}`,
        `人格：${skill.persona}`,
        `语气：${skill.tone}`,
        skill.knowledge ? `知识摘要：${skill.knowledge}` : "",
        skill.boundaries ? `边界：${skill.boundaries}` : "",
        "请保持角色一致，不要泄露导入资料中的隐私。"
      ].filter(Boolean).join("\n")
    },
    ...messages.slice(-30)
  ];
}

async function callOpenAICompatible(
  config: SecretModelConfig,
  messages: Array<{ role: string; content: string }>
): Promise<{ content: string; modelLabel: string }> {
  const response = await fetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.defaultModel,
      messages,
      temperature: 0.7
    })
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    modelLabel: `${config.name} / ${config.defaultModel}`
  };
}

async function callAnthropic(
  config: SecretModelConfig,
  messages: Array<{ role: string; content: string }>
): Promise<{ content: string; modelLabel: string }> {
  const system = messages.find((message) => message.role === "system")?.content;
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));
  const response = await fetch(`${trimSlash(config.baseUrl)}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.defaultModel,
      system,
      messages: conversation,
      max_tokens: 1200
    })
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return {
    content: data?.content?.map((part: any) => part.text ?? "").join("") ?? "",
    modelLabel: `${config.name} / ${config.defaultModel}`
  };
}

async function callGoogle(
  config: SecretModelConfig,
  messages: Array<{ role: string; content: string }>
): Promise<{ content: string; modelLabel: string }> {
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
  const systemInstruction = messages.find((message) => message.role === "system")?.content;
  const response = await fetch(`${trimSlash(config.baseUrl)}/models/${config.defaultModel}:generateContent?key=${config.apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
    })
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return {
    content: data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("") ?? "",
    modelLabel: `${config.name} / ${config.defaultModel}`
  };
}

async function listModels(config: Omit<UserModelTestInput, "defaultModel"> & { defaultModel?: string }): Promise<string[]> {
  if (config.kind === "ollama") {
    const data = await requestJson(`${trimSlash(config.baseUrl)}/api/tags`, {
      method: "GET"
    });
    return Array.isArray(data?.models) ? data.models.map((model: any) => String(model.name ?? "")).filter(Boolean) : [];
  }

  if (config.kind === "google") {
    const data = await requestJson(`${trimSlash(config.baseUrl)}/models?key=${encodeURIComponent(config.apiKey)}`, {
      method: "GET"
    });
    return Array.isArray(data?.models)
      ? data.models.map((model: any) => String(model.name ?? "").replace(/^models\//, "")).filter(Boolean)
      : [];
  }

  if (config.kind === "anthropic") {
    const data = await requestJson(`${trimSlash(config.baseUrl)}/models`, {
      method: "GET",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      }
    });
    return Array.isArray(data?.data) ? data.data.map((model: any) => String(model.id ?? "")).filter(Boolean) : [];
  }

  const data = await requestJson(`${trimSlash(config.baseUrl)}/models`, {
    method: "GET",
    headers: {
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    }
  });
  return Array.isArray(data?.data) ? data.data.map((model: any) => String(model.id ?? "")).filter(Boolean) : [];
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...init.headers
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readApiError(data, response.status));
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("检测超时，请检查网络或接口地址。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readApiError(data: any, status: number): string {
  return data?.error?.message ?? data?.message ?? `接口检测失败（HTTP ${status}）。`;
}

function providerKeyScore(kind: ProviderKind, apiKey: string): number {
  if (kind === "openai" && /^sk-/.test(apiKey)) return 5;
  if (kind === "anthropic" && /^sk-ant-/.test(apiKey)) return 8;
  if (kind === "google" && /^AIza/.test(apiKey)) return 8;
  if (kind === "deepseek" && /^sk-/.test(apiKey)) return 4;
  return 1;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}
