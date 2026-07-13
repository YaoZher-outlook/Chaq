import assert from "node:assert/strict";
import test from "node:test";
import { AgentHttpAttemptStatus, AgentRunStatus, AgentRunTrigger } from "@prisma/client";
import { AgentRuntimeService } from "./agent-runtime.service";

test("agent runtime compiles its LangGraph topology", () => {
  assert.doesNotThrow(() => new AgentRuntimeService({} as never, {} as never, {} as never));
});

test("agent runs are claimed with a single compare-and-set execution lease", async () => {
  const updates: any[] = [];
  const run = {
    id: "run-1",
    agentId: "agent-1",
    conversationId: null,
    trigger: AgentRunTrigger.MANUAL,
    status: AgentRunStatus.QUEUED
  };
  const runtime = new AgentRuntimeService({
    agentRun: {
      findUnique: async () => run,
      updateMany: async (input: any) => {
        updates.push(input);
        return { count: updates.length === 1 ? 1 : 0 };
      }
    }
  } as never, {} as never, {} as never) as any;

  const claimed = await runtime.claimRun(run.id);
  const duplicate = await runtime.claimRun(run.id);

  assert.equal(claimed.run.id, run.id);
  assert.match(claimed.executionId, /^[0-9a-f-]{36}$/);
  assert.equal(updates[0].where.status, AgentRunStatus.QUEUED);
  assert.equal(updates[0].data.status, AgentRunStatus.RUNNING);
  assert.ok(updates[0].data.leaseExpiresAt instanceof Date);
  assert.equal(duplicate, null);
});

test("agent completion output is bounded by the remaining raw token budget", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  const allowed = runtime.agentCompletionLimit("system", "short prompt", 1_000);
  assert.ok(allowed > 0 && allowed < 1_000);
  assert.equal(runtime.agentCompletionLimit("system", "x".repeat(2_000), 1_000), 0);
  assert.equal(runtime.agentCompletionLimit("system", "prompt", 1), 0);
});

test("user-triggered runs bill the message author while autonomous runs bill the owner", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.equal(runtime.modelPayerUserId({
    run: { trigger: "USER_MESSAGE", triggerPayload: { authorId: "chat-user" } },
    agent: { ownerId: "agent-owner" }
  }), "chat-user");
  assert.equal(runtime.modelPayerUserId({
    run: { trigger: "SCHEDULED", triggerPayload: null },
    agent: { ownerId: "agent-owner" }
  }), "agent-owner");
});

test("HTTP tool config defaults to GET and rejects unsafe methods", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.equal(runtime.httpToolConfig({ url: "https://api.example.com/search" }).method, "GET");
  assert.equal(runtime.httpToolConfig({ url: "https://api.example.com/search", method: "post" }).method, "POST");
  assert.throws(
    () => runtime.httpToolConfig({ url: "https://api.example.com/search", method: "DELETE" }),
    /method must be GET, POST, or HEAD/
  );
  assert.throws(
    () => runtime.httpToolConfig({
      url: "https://api.example.com/search",
      headers: { Host: "internal.example" }
    }),
    /controlled by the transport/
  );
});

test("HTTP tool URL guard rejects local and private network targets", async () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  await assert.doesNotReject(runtime.assertAllowedHttpUrl("https://8.8.8.8/search", {}));
  await assert.rejects(runtime.assertAllowedHttpUrl("http://8.8.8.8/search", {}), /require HTTPS/);
  await assert.rejects(runtime.assertAllowedHttpUrl("http://127.0.0.1:24537/api", { allowHttp: true }), /private network/);
  await assert.rejects(runtime.assertAllowedHttpUrl("http://192.168.1.8/api", { allowHttp: true }), /private network/);
  await assert.rejects(runtime.assertAllowedHttpUrl("http://[::1]/api", { allowHttp: true }), /private network/);
});

test("agent runtime converts model failures into safe chat feedback", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.match(runtime.failureReply("fetch failed"), /连不上模型服务/);
  assert.match(runtime.failureReply("Provider API key is not configured."), /API Key/);
  assert.match(runtime.failureReply("Token balance is insufficient"), /Token/);
});

test("runtime rejects run conversations that do not include the agent", async () => {
  const prisma = {
    agentRun: {
      findUnique: async () => ({
        id: "run-1",
        agentId: "agent-1",
        trigger: "MANUAL",
        triggerPayload: null,
        agent: {
          id: "agent-1",
          ownerId: "owner-1",
          relationships: [],
          goals: [],
          tasks: [],
          memories: [],
          tools: []
        },
        conversation: {
          participants: [{ participantKind: "USER", participantId: "user-1" }],
          messages: []
        }
      })
    }
  };
  const models = {
    agentEmbedding: async () => {
      throw new Error("embedding should not be requested");
    }
  };
  const runtime = new AgentRuntimeService(prisma as never, models as never, {} as never) as any;

  await assert.rejects(
    runtime.loadContext("run-1"),
    /does not include this agent/
  );
});

test("runtime refuses tasks linked to another agent's goal", async () => {
  const tx = {
    agentEvent: {
      findUnique: async () => null,
      create: async () => {
        throw new Error("event should not be created");
      }
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
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx)
  };
  const runtime = new AgentRuntimeService(prisma as never, {} as never, {} as never) as any;

  await assert.rejects(
    runtime.executeAction(
      {
        runId: "run-1",
        context: {
          agent: { id: "agent-1" },
          tools: [{ name: "manage_task", enabled: true }]
        }
      },
      { type: "create_task", title: "Follow up", goalId: "other-agent-goal" },
      "run-1:action:0"
    ),
    /Goal not found/
  );
});

test("a pending or uncertain HTTP attempt is never sent again", async () => {
  const attempt = {
    id: "attempt-1",
    idempotencyKey: "run-1:action:0",
    outboundKey: "chaq-key",
    requestHash: "hash-1",
    agentId: "agent-1",
    runId: "run-1",
    toolId: "tool-1",
    method: "POST",
    targetUrl: "https://8.8.8.8/hooks",
    status: AgentHttpAttemptStatus.UNCERTAIN,
    httpStatus: null,
    responsePreview: null,
    error: "timeout",
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const tx = { agentHttpToolAttempt: { findUnique: async () => attempt } };
  const prisma = { $transaction: async (callback: any) => callback(tx) };
  const runtime = new AgentRuntimeService(prisma as never, {} as never, {} as never) as any;

  const claim = await runtime.claimHttpAttempt({
    idempotencyKey: attempt.idempotencyKey,
    outboundKey: attempt.outboundKey,
    requestHash: attempt.requestHash,
    agentId: attempt.agentId,
    runId: attempt.runId,
    toolId: attempt.toolId,
    method: attempt.method,
    targetUrl: attempt.targetUrl
  });

  assert.equal(claim.state, "blocked");
  assert.equal(claim.attempt.status, AgentHttpAttemptStatus.UNCERTAIN);
});

test("a transient failed GET is reclaimed with a bounded retry generation", async () => {
  const attempt = {
    id: "attempt-get-1",
    idempotencyKey: "run-1:action:0",
    outboundKey: "chaq-get",
    requestHash: "hash-get",
    agentId: "agent-1",
    runId: "run-1",
    toolId: "tool-1",
    method: "GET",
    targetUrl: "https://8.8.8.8/data",
    attempt: 1,
    status: AgentHttpAttemptStatus.FAILED,
    httpStatus: 503,
    responsePreview: "unavailable",
    error: "temporary",
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  let reclaimed = false;
  const tx = {
    agentHttpToolAttempt: {
      findUnique: async () => attempt,
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.attempt, 1);
        assert.deepEqual(data.attempt, { increment: 1 });
        reclaimed = true;
        return { count: 1 };
      }
    }
  };
  const runtime = new AgentRuntimeService({
    $transaction: async (callback: any) => callback(tx)
  } as never, {} as never, {} as never) as any;

  const claim = await runtime.claimHttpAttempt({
    idempotencyKey: attempt.idempotencyKey,
    outboundKey: attempt.outboundKey,
    requestHash: attempt.requestHash,
    agentId: attempt.agentId,
    runId: attempt.runId,
    toolId: attempt.toolId,
    method: attempt.method,
    targetUrl: attempt.targetUrl
  });

  assert.equal(reclaimed, true);
  assert.equal(claim.state, "acquired");
  assert.equal(claim.attempt.attempt, 2);
});

test("POST failures and exhausted safe retries remain blocked", () => {
  const runtime = new AgentRuntimeService({} as never, {} as never, {} as never) as any;
  assert.equal(runtime.canRetryHttpAttempt({ method: "POST", status: AgentHttpAttemptStatus.FAILED, attempt: 1, httpStatus: 503 }), false);
  assert.equal(runtime.canRetryHttpAttempt({ method: "GET", status: AgentHttpAttemptStatus.FAILED, attempt: 3, httpStatus: 503 }), false);
  assert.equal(runtime.canRetryHttpAttempt({ method: "GET", status: AgentHttpAttemptStatus.FAILED, attempt: 1, httpStatus: 400 }), false);
});

test("HTTP attempt idempotency keys reject changed request input", async () => {
  const existing = {
    id: "attempt-1",
    idempotencyKey: "run-1:action:0",
    requestHash: "original-hash",
    status: AgentHttpAttemptStatus.PENDING
  };
  const tx = { agentHttpToolAttempt: { findUnique: async () => existing } };
  const prisma = { $transaction: async (callback: any) => callback(tx) };
  const runtime = new AgentRuntimeService(prisma as never, {} as never, {} as never) as any;

  await assert.rejects(runtime.claimHttpAttempt({
    idempotencyKey: existing.idempotencyKey,
    outboundKey: "chaq-key",
    requestHash: "different-hash",
    agentId: "agent-1",
    runId: "run-1",
    toolId: "tool-1",
    method: "POST",
    targetUrl: "https://8.8.8.8/hooks"
  }), /different input/);
});

test("uncertain HTTP attempts are finalized once and count one outbound use", async () => {
  let status = AgentHttpAttemptStatus.PENDING;
  let usageCount = 0;
  const tx = {
    agentHttpToolAttempt: {
      updateMany: async ({ where, data }: any) => {
        if (status !== where.status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      }
    },
    agentTool: { update: async () => { usageCount += 1; } }
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) };
  const runtime = new AgentRuntimeService(prisma as never, {} as never, {} as never) as any;
  const attempt = { id: "attempt-1" };
  const failure = {
    status: AgentHttpAttemptStatus.UNCERTAIN,
    error: "socket closed after request dispatch",
    toolId: "tool-1"
  };

  await runtime.finishHttpAttempt(attempt, failure);
  await runtime.finishHttpAttempt(attempt, failure);

  assert.equal(status, AgentHttpAttemptStatus.UNCERTAIN);
  assert.equal(usageCount, 1);
});
