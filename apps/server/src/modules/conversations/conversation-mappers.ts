import type { ConversationMessage, ConversationSummary } from "@chaq/shared";

const lower = <T extends string>(value: string): T => value.toLowerCase() as T;

export function toConversationMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorKind: lower(row.authorKind),
    authorId: row.authorId,
    kind: lower(row.kind),
    content: row.content,
    status: lower(row.status),
    replyToId: row.replyToId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString()
  };
}

export function toConversationSummary(row: any, userId: string): ConversationSummary {
  const userParticipant = row.participants.find((participant: any) =>
    participant.participantKind === "USER" && participant.participantId === userId
  );
  const lastMessageRow = row.messages?.[0] ?? null;
  const lastMessage = lastMessageRow ? toConversationMessage(lastMessageRow) : null;
  const unreadCount = lastMessageRow
    && (!userParticipant?.lastReadAt || userParticipant.lastReadAt < lastMessageRow.createdAt)
    && lastMessageRow.authorId !== userId
    ? 1
    : 0;
  return {
    id: row.id,
    kind: lower(row.kind),
    title: row.title,
    participants: row.participants.map((participant: any) => ({
      id: participant.id,
      participantKind: lower(participant.participantKind),
      participantId: participant.participantId,
      displayNameSnapshot: participant.displayNameSnapshot,
      lastReadAt: participant.lastReadAt?.toISOString() ?? null,
      muted: participant.muted
    })),
    lastMessage,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unreadCount,
    createdAt: row.createdAt.toISOString()
  };
}
