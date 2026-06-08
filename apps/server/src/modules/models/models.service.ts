import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ModelProviderConfig, ProviderKind } from "@prisma/client";
import type { CloudChatRequest, CloudChatResponse, DistillRequest, DistillResponse, ModelProviderPublic, SkillDraft } from "@chaq/shared";
import { PrismaService } from "../../common/prisma.service";
import { UsersService } from "../users/users.service";

type ProviderInput = {
  id?: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{ id: string; label: string; contextWindow: number }>;
  enabled: boolean;
  promptTokenPrice: number;
  completionTokenPrice: number;
  contextWindow: number;
};

type ProviderCallResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

@Injectable()
export class ModelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService
  ) {}

  async publicProviders(): Promise<ModelProviderPublic[]> {
    const providers = await this.prisma.modelProviderConfig.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    });
    return providers.map((provider) => this.toPublicProvider(provider));
  }

  async adminProviders(userId: string): Promise<ModelProviderPublic[]> {
    await this.users.assertAdmin(userId);
    const providers = await this.prisma.modelProviderConfig.findMany({ orderBy: { createdAt: "desc" } });
    return providers.map((provider) => this.toPublicProvider(provider));
  }

  async upsertProvider(userId: string, input: ProviderInput): Promise<ModelProviderPublic> {
    await this.users.assertAdmin(userId);
    const data = {
      kind: this.toPrismaProviderKind(input.kind),
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      apiKeyCiphertext: this.sealApiKey(input.apiKey),
      models: input.models,
      enabled: input.enabled,
      promptTokenPrice: input.promptTokenPrice,
      completionTokenPrice: input.completionTokenPrice,
      contextWindow: input.contextWindow
    };
    const provider = input.id
      ? await this.prisma.modelProviderConfig.update({ where: { id: input.id }, data })
      : await this.prisma.modelProviderConfig.create({ data });
    return this.toPublicProvider(provider);
  }

  async updateProviderStatus(userId: string, id: string, enabled: boolean): Promise<ModelProviderPublic> {
    await this.users.assertAdmin(userId);
    const provider = await this.prisma.modelProviderConfig.update({
      where: { id },
      data: { enabled }
    });
    return this.toPublicProvider(provider);
  }

  async cloudChat(userId: string, input: CloudChatRequest): Promise<CloudChatResponse> {
    const provider = await this.getEnabledProvider(input.providerId);
    const messages = this.buildSkillMessages(input.skill, input.messages);
    const estimatedPrompt = this.estimateTokens(messages.map((message) => message.content).join("\n"));
    const estimatedCompletion = Math.max(64, Math.ceil(estimatedPrompt * 0.4));
    const estimatedCharge = this.calculateCharge(provider, estimatedPrompt, estimatedCompletion);
    const user = await this.users.ensureUser(userId);
    if (user.tokenBalance < estimatedCharge) {
      throw new ForbiddenException("Token balance is insufficient for the estimated cloud model call.");
    }

    const started = Date.now();
    try {
      const result = await this.callProvider(provider, input.model, messages);
      const chargedTokens = this.calculateCharge(provider, result.promptTokens, result.completionTokens);
      const balanceAfter = await this.users.chargeForModelUsage(userId, chargedTokens, `Cloud chat via ${provider.name}`, {
        providerId: provider.id,
        model: input.model
      });
      await this.prisma.modelCallLog.create({
        data: {
          userId,
          providerId: provider.id,
          model: input.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          chargedTokens,
          success: true
        }
      });
      return {
        content: result.content,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        chargedTokens,
        balanceAfter,
        modelLabel: `${provider.name} / ${input.model}`
      };
    } catch (error) {
      await this.prisma.modelCallLog.create({
        data: {
          userId,
          providerId: provider.id,
          model: input.model,
          promptTokens: estimatedPrompt,
          completionTokens: 0,
          chargedTokens: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      const elapsed = Date.now() - started;
      throw new BadRequestException(`Cloud model call failed after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async distill(userId: string, input: DistillRequest): Promise<DistillResponse> {
    if (!input.providerId || !input.model) {
      return { draft: this.heuristicDraft(input) };
    }

    const provider = await this.getEnabledProvider(input.providerId);
    const selected = input.messages.filter((message) => message.selected);
    const transcript = selected
      .slice(0, 400)
      .map((message) => `${message.timestamp ? `[${message.timestamp}] ` : ""}${message.speaker}: ${message.content}`)
      .join("\n");
    const system = "你是 Chaq 的 skill 蒸馏器。只输出 JSON，不要输出原始长聊天记录。";
    const prompt = [
      "请把下面的聊天/资料蒸馏为一个可聊天的虚拟 skill。",
      "JSON 字段必须是 name, description, persona, tone, knowledge, boundaries, examples, tags。",
      "examples 是 { user, assistant } 数组，tags 是短标签数组。",
      input.preferredName ? `用户偏好的 skill 名称：${input.preferredName}` : "",
      "禁止复制超过 80 个连续字符的原文。",
      transcript
    ].filter(Boolean).join("\n\n");

    const estimatedPrompt = this.estimateTokens(system + prompt);
    const estimatedCompletion = 900;
    const user = await this.users.ensureUser(userId);
    const estimatedCharge = this.calculateCharge(provider, estimatedPrompt, estimatedCompletion);
    if (user.tokenBalance < estimatedCharge) {
      throw new ForbiddenException("Token balance is insufficient for the estimated distillation call.");
    }

    const result = await this.callProvider(provider, input.model, [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ]);
    const chargedTokens = this.calculateCharge(provider, result.promptTokens, result.completionTokens);
    const balanceAfter = await this.users.chargeForModelUsage(userId, chargedTokens, `Distillation via ${provider.name}`, {
      providerId: provider.id,
      model: input.model,
      sourceKind: input.sourceKind
    });
    await this.prisma.modelCallLog.create({
      data: {
        userId,
        providerId: provider.id,
        model: input.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        chargedTokens,
        success: true
      }
    });

    return {
      draft: this.parseDraftOrFallback(result.content, input),
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      balanceAfter
    };
  }

  buildSkillMessages(skill: SkillDraft, messages: Array<{ role: string; content: string }>) {
    const system = [
      `你正在扮演 Chaq skill：${skill.name}`,
      `简介：${skill.description}`,
      `人格：${skill.persona}`,
      `语气：${skill.tone}`,
      skill.knowledge ? `知识摘要：${skill.knowledge}` : "",
      skill.boundaries ? `边界：${skill.boundaries}` : "",
      "请保持角色一致，不要声称你看到了未提供的原始聊天记录。"
    ].filter(Boolean).join("\n");

    return [
      { role: "system", content: system },
      ...messages.slice(-30).map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];
  }

  heuristicDraft(input: DistillRequest): SkillDraft {
    const selected = input.messages.filter((message) => message.selected);
    const speakerCounts = new Map<string, number>();
    const snippets: string[] = [];
    for (const message of selected.slice(0, 200)) {
      speakerCounts.set(message.speaker, (speakerCounts.get(message.speaker) ?? 0) + 1);
      if (snippets.length < 12 && message.content.length > 8) {
        snippets.push(`${message.speaker}: ${message.content.slice(0, 80)}`);
      }
    }
    const topSpeakers = [...speakerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const mainName = input.preferredName || topSpeakers[0]?.[0] || "新的 Skill";
    const sourceLabel = input.sourceKind.toUpperCase();
    return {
      name: mainName,
      avatarUrl: null,
      description: `从 ${sourceLabel} 导入资料蒸馏出的聊天 skill。`,
      persona: `这个 skill 基于 ${selected.length} 条已选择消息整理而成。重点保留主要说话人的表达习惯、关系背景和常见关注点。`,
      tone: `语气参考高频说话人：${topSpeakers.map(([speaker, count]) => `${speaker}(${count})`).join("、") || "未识别"}。回复应自然、克制，不直接复述原始材料。`,
      knowledge: snippets.join("\n"),
      boundaries: "不要泄露原始导入资料中的隐私信息；不确定的事实要说明不确定；避免冒充真实本人做承诺。",
      examples: [
        {
          user: "今天有点不知道该怎么开始。",
          assistant: "那我们先从最轻的一步开始。你把现在最占脑子的那件事说出来，我陪你一起拆。"
        }
      ],
      tags: [input.sourceKind, "蒸馏", "私有"]
    };
  }

  private parseDraftOrFallback(content: string, input: DistillRequest): SkillDraft {
    const fallback = this.heuristicDraft(input);
    try {
      const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
      const parsed = JSON.parse(jsonText) as Partial<SkillDraft>;
      return {
        ...fallback,
        ...parsed,
        name: parsed.name || fallback.name,
        description: parsed.description || fallback.description,
        persona: parsed.persona || fallback.persona,
        tone: parsed.tone || fallback.tone,
        knowledge: parsed.knowledge || fallback.knowledge,
        boundaries: parsed.boundaries || fallback.boundaries,
        examples: Array.isArray(parsed.examples) ? parsed.examples.slice(0, 8) : fallback.examples,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : fallback.tags
      };
    } catch {
      return {
        ...fallback,
        knowledge: `${fallback.knowledge}\n\n模型返回摘要：${content.slice(0, 1500)}`
      };
    }
  }

  private async getEnabledProvider(providerId: string): Promise<ModelProviderConfig> {
    const provider = await this.prisma.modelProviderConfig.findUnique({ where: { id: providerId } });
    if (!provider || !provider.enabled) {
      throw new NotFoundException("Enabled cloud model provider not found.");
    }
    return provider;
  }

  private async callProvider(
    provider: ModelProviderConfig,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ProviderCallResult> {
    const apiKey = this.unsealApiKey(provider.apiKeyCiphertext);
    if (!apiKey || apiKey === "replace-me") {
      throw new BadRequestException("Provider API key is not configured.");
    }

    if (provider.kind === ProviderKind.ANTHROPIC) {
      return this.callAnthropic(provider, apiKey, model, messages);
    }
    if (provider.kind === ProviderKind.GOOGLE) {
      return this.callGoogle(provider, apiKey, model, messages);
    }
    if (provider.kind === ProviderKind.OLLAMA) {
      return this.callOpenAICompatible(provider, "", model, messages);
    }
    return this.callOpenAICompatible(provider, apiKey, model, messages);
  }

  private async callOpenAICompatible(
    provider: ModelProviderConfig,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ProviderCallResult> {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7
      })
    });
    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
    }
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      content,
      promptTokens: Number(data?.usage?.prompt_tokens ?? this.estimateTokens(JSON.stringify(messages))),
      completionTokens: Number(data?.usage?.completion_tokens ?? this.estimateTokens(content))
    };
  }

  private async callAnthropic(
    provider: ModelProviderConfig,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ProviderCallResult> {
    const system = messages.find((message) => message.role === "system")?.content;
    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        system,
        messages: conversation,
        max_tokens: 1200
      })
    });
    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
    }
    const content = data?.content?.map((part: any) => part.text ?? "").join("") ?? "";
    return {
      content,
      promptTokens: Number(data?.usage?.input_tokens ?? this.estimateTokens(JSON.stringify(messages))),
      completionTokens: Number(data?.usage?.output_tokens ?? this.estimateTokens(content))
    };
  }

  private async callGoogle(
    provider: ModelProviderConfig,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<ProviderCallResult> {
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }));
    const systemInstruction = messages.find((message) => message.role === "system")?.content;
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${apiKey}`, {
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
    const content = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("") ?? "";
    return {
      content,
      promptTokens: Number(data?.usageMetadata?.promptTokenCount ?? this.estimateTokens(JSON.stringify(messages))),
      completionTokens: Number(data?.usageMetadata?.candidatesTokenCount ?? this.estimateTokens(content))
    };
  }

  private calculateCharge(provider: ModelProviderConfig, promptTokens: number, completionTokens: number): number {
    return Math.max(1, Math.ceil(promptTokens * provider.promptTokenPrice + completionTokens * provider.completionTokenPrice));
  }

  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private toPublicProvider(provider: ModelProviderConfig): ModelProviderPublic {
    return {
      id: provider.id,
      kind: provider.kind.toLowerCase() as ModelProviderPublic["kind"],
      name: provider.name,
      baseUrl: provider.baseUrl,
      models: provider.models as unknown as ModelProviderPublic["models"],
      enabled: provider.enabled,
      promptTokenPrice: provider.promptTokenPrice,
      completionTokenPrice: provider.completionTokenPrice,
      contextWindow: provider.contextWindow
    };
  }

  private toPrismaProviderKind(kind: string): ProviderKind {
    const upper = kind.toUpperCase();
    if (!(upper in ProviderKind)) {
      throw new BadRequestException(`Unsupported provider kind: ${kind}`);
    }
    return ProviderKind[upper as keyof typeof ProviderKind];
  }

  private sealApiKey(apiKey: string): string {
    return Buffer.from(apiKey, "utf8").toString("base64");
  }

  private unsealApiKey(ciphertext: string): string {
    try {
      return Buffer.from(ciphertext, "base64").toString("utf8");
    } catch {
      return ciphertext;
    }
  }
}
