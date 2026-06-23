import assert from "node:assert/strict";
import test from "node:test";
import { ModelProviderScope, ProviderKind, TokenTransactionKind } from "@prisma/client";
import { ModelsService } from "./models.service";

function serviceWith(prisma: Record<string, unknown>): ModelsService {
  return new ModelsService(prisma as never, { ensureUser: async () => ({ id: "user-1" }) } as never);
}

test("public provider listing is limited to enabled platform providers", async () => {
  let where: unknown;
  const service = serviceWith({
    modelProviderConfig: {
      findMany: async (input: { where: unknown }) => {
        where = input.where;
        return [];
      }
    }
  });

  await service.publicProviders();
  assert.deepEqual(where, { scope: ModelProviderScope.PLATFORM, enabled: true });
});

test("available provider listing includes platform and only the current user's private providers", async () => {
  let where: any;
  const service = serviceWith({
    modelProviderConfig: {
      findMany: async (input: { where: unknown }) => {
        where = input.where;
        return [];
      }
    }
  });

  await service.availableProviders("user-1");
  assert.equal(where.enabled, true);
  assert.deepEqual(where.OR, [
    { scope: ModelProviderScope.PLATFORM },
    { scope: ModelProviderScope.USER_PRIVATE, ownerId: "user-1" }
  ]);
});

test("provider projection exposes embedding metadata stored in model JSON", async () => {
  const provider = {
    id: "platform-embed",
    scope: ModelProviderScope.PLATFORM,
    ownerId: null,
    kind: ProviderKind.OPENAI,
    name: "Embedding Provider",
    baseUrl: "https://api.example.com/v1",
    apiKeyCiphertext: "hidden",
    models: [{ id: "chat-model", label: "Chat Model", contextWindow: 128000, embeddingModel: "text-embedding-3-small", embeddingTokenPrice: 0.002 }],
    enabled: true,
    promptTokenPrice: 0,
    completionTokenPrice: 0,
    contextWindow: 128000,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const service = serviceWith({
    modelProviderConfig: {
      findMany: async () => [provider]
    }
  });

  const [publicProvider] = await service.publicProviders();
  assert.equal(publicProvider.embeddingModel, "text-embedding-3-small");
  assert.equal(publicProvider.embeddingTokenPrice, 0.002);
});

test("agent embedding falls back when a provider has no embedding model", async () => {
  const service = serviceWith({
    agent: {
      findUnique: async () => ({ id: "agent-1", ownerId: "user-1", modelProviderId: null })
    }
  });

  const result = await service.agentEmbedding("agent-1", "hello vector world", "user-1");
  assert.equal(result.model, "chaq-hash-v1");
  assert.equal(result.fallback, true);
  assert.ok(result.vector.length > 0);
});

test("agent embedding calls OpenAI-compatible embeddings when configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: [{ embedding: [1, 2, 2] }]
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const service = serviceWith({
      agent: {
        findUnique: async () => ({ id: "agent-1", ownerId: "user-1", modelProviderId: "provider-1" })
      },
      modelProviderConfig: {
        findUnique: async () => ({
          id: "provider-1",
          scope: ModelProviderScope.PLATFORM,
          ownerId: null,
          kind: ProviderKind.OPENAI,
          name: "Provider",
          baseUrl: "https://api.example.com/v1",
          apiKeyCiphertext: "base64:a2V5",
          models: [{ id: "chat", label: "Chat", contextWindow: 1000, embeddingModel: "embed-small" }],
          enabled: true,
          promptTokenPrice: 0,
          completionTokenPrice: 0,
          contextWindow: 1000,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      },
      modelCallLog: { create: async ({ data }: any) => ({ id: "log-1", ...data }) }
    });

    const result = await service.agentEmbedding("agent-1", "semantic text", "user-1");
    assert.equal(result.model, "embed-small");
    assert.equal(result.fallback, false);
    assert.deepEqual(result.vector, [0.33333333, 0.66666667, 0.66666667]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("private providers cannot be used by public agents or another owner", async () => {
  const privateProvider = {
    id: "private-1",
    scope: ModelProviderScope.USER_PRIVATE,
    ownerId: "user-1",
    kind: ProviderKind.OPENAI,
    name: "Private",
    baseUrl: "https://api.openai.com/v1",
    apiKeyCiphertext: "hidden",
    models: [],
    enabled: true,
    promptTokenPrice: 0,
    completionTokenPrice: 0,
    contextWindow: 128000,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const service = serviceWith({
    modelProviderConfig: { findUnique: async () => privateProvider }
  });

  await service.assertAgentProviderAccess("user-1", "private-1", "private");
  await assert.rejects(
    service.assertAgentProviderAccess("user-1", "private-1", "public"),
    /Public and unlisted agents can only use platform model providers/
  );
  await assert.rejects(
    service.assertAgentProviderAccess("user-2", "private-1", "private"),
    /Enabled cloud model provider not found/
  );
});

test("user-private providers reject local Ollama endpoints", async () => {
  const service = serviceWith({});
  await assert.rejects(
    service.upsertPrivateProvider("user-1", {
      kind: "ollama",
      name: "Local Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      contextWindow: 8192
    }),
    /must use a cloud API reachable by the server/
  );
});

test("agent completion persistence charges payer and credits service fee atomically", async () => {
  const charges: Array<{ amount: number; kind: TokenTransactionKind }> = [];
  const credits: Array<{ userId: string; amount: number; kind: TokenTransactionKind }> = [];
  let createdLog: any;
  const tx = {
    modelCallLog: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        createdLog = data;
        return { id: "log-1", ...data };
      }
    }
  };
  const prisma = { $transaction: async (callback: (client: any) => unknown) => callback(tx) };
  let balance = 100;
  const users = {
    chargeForModelUsageInTransaction: async (_tx: unknown, _userId: string, amount: number, _note: string, _metadata: unknown, kind: TokenTransactionKind) => {
      charges.push({ amount, kind });
      balance -= amount;
      return balance;
    },
    creditTokensInTransaction: async (_tx: unknown, userId: string, amount: number, _note: string, _metadata: unknown, kind: TokenTransactionKind) => {
      credits.push({ userId, amount, kind });
      return 500 + amount;
    }
  };
  const service = new ModelsService(prisma as never, users as never) as any;
  const provider = { id: "platform-1", name: "Platform" };

  const result = await service.persistAgentCompletion(
    "payer-1",
    { providerId: "platform-1", model: "model-1", agentId: "agent-1", runId: "run-1" },
    provider,
    { content: "hello", promptTokens: 10, completionTokens: 5 },
    12,
    4,
    "owner-1"
  );

  assert.deepEqual(charges, [
    { amount: 12, kind: TokenTransactionKind.AGENT_MODEL_USAGE },
    { amount: 4, kind: TokenTransactionKind.AGENT_SERVICE_FEE }
  ]);
  assert.deepEqual(credits, [{ userId: "owner-1", amount: 4, kind: TokenTransactionKind.AGENT_SERVICE_EARNING }]);
  assert.equal(createdLog.chargedTokens, 16);
  assert.equal(createdLog.serviceFee, 4);
  assert.equal(result.balanceAfter, 84);
});
