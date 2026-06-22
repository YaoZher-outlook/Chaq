import assert from "node:assert/strict";
import test from "node:test";
import { toConversationSummary } from "./conversation-mappers";

test("conversation summary marks a newer agent message unread", () => {
  const createdAt = new Date("2026-06-21T10:00:00.000Z");
  const summary = toConversationSummary({
    id: "conversation-1",
    kind: "HUMAN_AGENT",
    title: "Lin",
    lastMessageAt: createdAt,
    createdAt,
    participants: [
      {
        id: "participant-user",
        participantKind: "USER",
        participantId: "user-1",
        displayNameSnapshot: "User",
        lastReadAt: new Date("2026-06-21T09:00:00.000Z"),
        muted: false
      }
    ],
    messages: [
      {
        id: "message-1",
        conversationId: "conversation-1",
        authorKind: "AGENT",
        authorId: "agent-1",
        kind: "TEXT",
        content: "Hello",
        status: "DELIVERED",
        replyToId: null,
        metadata: null,
        createdAt
      }
    ]
  }, "user-1");

  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.lastMessage?.authorKind, "agent");
});

test("conversation summary does not mark the user's own message unread", () => {
  const createdAt = new Date("2026-06-21T10:00:00.000Z");
  const summary = toConversationSummary({
    id: "conversation-2",
    kind: "HUMAN_AGENT",
    title: "Lin",
    lastMessageAt: createdAt,
    createdAt,
    participants: [
      {
        id: "participant-user",
        participantKind: "USER",
        participantId: "user-1",
        displayNameSnapshot: "User",
        lastReadAt: null,
        muted: false
      }
    ],
    messages: [
      {
        id: "message-2",
        conversationId: "conversation-2",
        authorKind: "USER",
        authorId: "user-1",
        kind: "TEXT",
        content: "Hello",
        status: "DELIVERED",
        replyToId: null,
        metadata: null,
        createdAt
      }
    ]
  }, "user-1");

  assert.equal(summary.unreadCount, 0);
});
