import assert from "node:assert/strict";
import test from "node:test";
import { KnowledgeSourceKind } from "@prisma/client";
import { AgentsService } from "./agents.service";

test("knowledge search preview ranks chunks and exposes embedding diagnostics", async () => {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: "agent-1", ownerId: "owner-1" })
    },
    agentKnowledgeChunk: {
      findMany: async () => [
        {
          id: "chunk-low",
          source: { id: "source-1", title: "Other facts", kind: KnowledgeSourceKind.NOTE },
          position: 1,
          content: "A general note.",
          embedding: [0, 1],
          embeddingModel: "test-embed",
          keywords: ["general"]
        },
        {
          id: "chunk-high",
          source: { id: "source-2", title: "Pricing policy", kind: KnowledgeSourceKind.NOTE },
          position: 0,
          content: "Pricing uses platform tokens.",
          embedding: [1, 0],
          embeddingModel: "test-embed",
          keywords: ["pricing", "tokens"]
        }
      ]
    }
  };
  const models = {
    agentEmbedding: async () => ({
      vector: [1, 0],
      model: "test-embed",
      fallback: false,
      promptTokens: 3,
      chargedTokens: 0
    })
  };

  const result = await new AgentsService(prisma as never, {} as never, models as never, {} as never)
    .searchKnowledge("owner-1", "agent-1", { query: "pricing tokens", limit: 2 });

  assert.equal(result.queryEmbeddingModel, "test-embed");
  assert.equal(result.queryUsedFallback, false);
  assert.equal(result.promptTokens, 3);
  assert.equal(result.results[0]?.id, "chunk-high");
  assert.equal(result.results[0]?.sourceTitle, "Pricing policy");
  assert.equal(result.results[0]?.sourceKind, "note");
  assert.equal(result.results[0]?.keywordScore, 2);
});
