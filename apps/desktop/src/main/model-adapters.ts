import type { ChatMessage, ProviderKind, SkillDraft, UserModelConfigPublic } from "@chaq/shared";

export type SecretModelConfig = UserModelConfigPublic & {
  apiKey: string;
};

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

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}
