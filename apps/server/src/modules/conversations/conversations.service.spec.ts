import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatus, AgentVisibility, ParticipantKind } from "@prisma/client";
import { ConversationsService } from "./conversations.service";

test("external agent conversations require an active contact before sending", async () => {
  const prisma = {
    agent: {
      findMany: async () => [{ id: "agent-2", ownerId: "owner-2", status: "ACTIVE", visibility: "PUBLIC" }]
    },
    agentContact: { count: async () => 0 }
  };
  const service = new ConversationsService(prisma as never, {} as never, { emitToUsers: () => undefined } as never) as any;

  await assert.rejects(
    service.assertCanMessageAgents("user-1", [{ participantKind: ParticipantKind.AGENT, participantId: "agent-2" }]),
    /Add every external agent in this conversation as a contact/
  );
});

test("external users cannot open conversations with inactive public agents", async () => {
  const prisma = {
    agent: {
      findFirst: async () => ({
        id: "agent-2",
        ownerId: "owner-2",
        name: "Paused Agent",
        status: AgentStatus.PAUSED,
        visibility: AgentVisibility.PUBLIC
      })
    },
    agentContact: {
      findUnique: async () => ({ id: "contact-1" })
    }
  };
  const service = new ConversationsService(prisma as never, {} as never, { emitToUsers: () => undefined } as never);

  await assert.rejects(
    service.withAgent("user-1", "agent-2"),
    /Agent not found/
  );
});

test("message idempotency keys cannot be replayed with changed content", () => {
  const service = new ConversationsService({} as never, {} as never, {} as never) as any;
  const message = {
    id: "message-1",
    conversationId: "conversation-1",
    authorKind: ParticipantKind.USER,
    authorId: "user-1",
    kind: "TEXT",
    content: "original",
    status: "SENT",
    replyToId: null,
    metadata: null,
    createdAt: new Date()
  };

  assert.throws(
    () => service.assertUserIdempotencyMatch(message, "user-1", "conversation-1", "changed", null),
    /different message/
  );
});

test("agent message idempotency keys bind the original target", () => {
  const service = new ConversationsService({} as never, {} as never, {} as never) as any;
  const message = {
    id: "message-1",
    conversationId: "conversation-1",
    authorKind: ParticipantKind.AGENT,
    authorId: "agent-1",
    kind: "TEXT",
    content: "hello",
    status: "SENT",
    replyToId: null,
    metadata: { targetKind: ParticipantKind.USER, targetId: "user-1" },
    createdAt: new Date()
  };

  assert.throws(
    () => service.assertAgentIdempotencyMatch(
      message,
      "agent-1",
      "conversation-1",
      "hello",
      ParticipantKind.USER,
      "user-2"
    ),
    /different agent message/
  );
});

test("reply targets must belong to the same conversation", async () => {
  let transactionStarted = false;
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: "conversation-1",
        participants: [{ participantKind: ParticipantKind.USER, participantId: "user-1" }]
      })
    },
    conversationMessage: { findFirst: async () => null },
    $transaction: async () => {
      transactionStarted = true;
    }
  };
  const service = new ConversationsService(prisma as never, {} as never, { emitToUsers: () => undefined } as never);

  await assert.rejects(
    service.sendUserMessage("user-1", "conversation-1", "hello", "message-from-another-conversation"),
    /Reply target not found in this conversation/
  );
  assert.equal(transactionStarted, false);
});

test("direct conversation lookup excludes conversations with extra participants", async () => {
  let where: any;
  const prisma = {
    conversation: {
      findFirst: async (input: any) => {
        where = input.where;
        return null;
      }
    }
  };
  const service = new ConversationsService(prisma as never, {} as never, { emitToUsers: () => undefined } as never) as any;

  await service.findDirect(ParticipantKind.USER, "user-1", ParticipantKind.AGENT, "agent-1");
  assert.deepEqual(where.participants.every.OR, [
    { participantKind: ParticipantKind.USER, participantId: "user-1" },
    { participantKind: ParticipantKind.AGENT, participantId: "agent-1" }
  ]);
});

test("serializable direct-conversation creation retries a database conflict", async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async (action: (tx: object) => Promise<string>) => {
      attempts += 1;
      if (attempts === 1) throw { code: "P2034" };
      return action({});
    }
  };
  const service = new ConversationsService(prisma as never, {} as never, {} as never) as any;

  assert.equal(await service.serializableTransaction(async () => "conversation-1"), "conversation-1");
  assert.equal(attempts, 2);
});
