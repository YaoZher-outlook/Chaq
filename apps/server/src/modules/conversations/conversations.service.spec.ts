import assert from "node:assert/strict";
import test from "node:test";
import { ParticipantKind } from "@prisma/client";
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
