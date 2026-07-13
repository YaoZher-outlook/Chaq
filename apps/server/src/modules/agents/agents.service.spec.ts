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

test("agent tasks cannot attach to another agent's goal", async () => {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: "agent-1", ownerId: "owner-1" })
    },
    agentGoal: {
      findFirst: async () => null
    },
    agentTask: {
      create: async () => {
        throw new Error("task should not be created");
      }
    }
  };

  const service = new AgentsService(prisma as never, {} as never, {} as never, {} as never);

  await assert.rejects(
    service.addTask("owner-1", "agent-1", {
      goalId: "other-agent-goal",
      title: "Follow up",
      description: "",
      priority: 50,
      scheduledFor: null
    }),
    /Goal not found/
  );
});

test("manual agent runs require both the owner user and agent in the conversation", async () => {
  let createdRun = false;
  let conversationWhere: any;
  const prisma = {
    agent: {
      findFirst: async () => ({ id: "agent-1", ownerId: "owner-1", status: "ACTIVE" })
    },
    conversation: {
      findFirst: async (input: any) => {
        conversationWhere = input.where;
        return null;
      }
    },
    agentRun: {
      create: async () => {
        createdRun = true;
      }
    }
  };
  const queue = {
    enqueueRun: async () => {
      throw new Error("run should not be queued");
    }
  };

  const service = new AgentsService(prisma as never, {} as never, {} as never, queue as never);

  await assert.rejects(
    service.runNow("owner-1", "agent-1", "conversation-without-agent"),
    /Conversation not found for this user and agent/
  );
  assert.equal(createdRun, false);
  assert.deepEqual(conversationWhere.AND, [
    { participants: { some: { participantKind: "AGENT", participantId: "agent-1" } } },
    { participants: { some: { participantKind: "USER", participantId: "owner-1" } } }
  ]);
});
