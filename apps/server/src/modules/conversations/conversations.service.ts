import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AgentEventKind,
  AgentRunStatus,
  AgentRunTrigger,
  AgentStatus,
  AgentVisibility,
  ConversationKind,
  ConversationMessageKind,
  ParticipantKind,
  Prisma
} from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import { RealtimeService } from "../../common/realtime.service";
import { AgentQueueService } from "../agents/agent-queue.service";
import { toConversationMessage, toConversationSummary } from "./conversation-mappers";

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentQueueService) private readonly queue: AgentQueueService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService
  ) {}

  async list(userId: string) {
    const agentIds = (await this.prisma.agent.findMany({ where: { ownerId: userId }, select: { id: true } })).map((row) => row.id);
    const rows = await this.prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            OR: [
              { participantKind: ParticipantKind.USER, participantId: userId },
              ...(agentIds.length ? [{ participantKind: ParticipantKind.AGENT, participantId: { in: agentIds } }] : [])
            ]
          }
        }
      },
      include: {
        participants: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 200
    });
    return rows.map((row) => toConversationSummary(row, userId));
  }

  async withAgent(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        OR: [{ ownerId: userId }, { visibility: { in: [AgentVisibility.PUBLIC, AgentVisibility.UNLISTED] } }]
      }
    });
    if (!agent) throw new NotFoundException("Agent not found.");
    if (agent.ownerId !== userId) {
      const contact = await this.prisma.agentContact.findUnique({
        where: { userId_agentId: { userId, agentId } },
        select: { id: true }
      });
      if (!contact) throw new ForbiddenException("Add this agent as a contact before starting a conversation.");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found.");
    const row = await this.findDirect(ParticipantKind.USER, userId, ParticipantKind.AGENT, agentId)
      ?? await this.prisma.conversation.create({
        data: {
          kind: ConversationKind.HUMAN_AGENT,
          title: agent.name,
          createdByKind: ParticipantKind.USER,
          createdById: userId,
          participants: {
            create: [
              { participantKind: ParticipantKind.USER, participantId: userId, displayNameSnapshot: user.displayName },
              { participantKind: ParticipantKind.AGENT, participantId: agent.id, displayNameSnapshot: agent.name }
            ]
          }
        },
        include: { participants: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } }
      });
    return toConversationSummary(row, userId);
  }

  async messages(userId: string, conversationId: string, before?: string) {
    await this.assertAccess(userId, conversationId);
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return rows.reverse().map(toConversationMessage);
  }

  async sendUserMessage(userId: string, conversationId: string, content: string, replyToId?: string | null) {
    const conversation = await this.assertAccess(userId, conversationId);
    await this.assertCanMessageAgents(userId, conversation.participants);
    const result = await this.prisma.$transaction(async (tx) => {
      const message = await tx.conversationMessage.create({
        data: {
          conversationId,
          authorKind: ParticipantKind.USER,
          authorId: userId,
          kind: ConversationMessageKind.TEXT,
          content,
          replyToId
        }
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
      const targetAgents = conversation.participants.filter((participant) => participant.participantKind === ParticipantKind.AGENT);
      const runs = [];
      for (const participant of targetAgents) {
        const agent = await tx.agent.findUnique({ where: { id: participant.participantId } });
        if (!agent || agent.status !== AgentStatus.ACTIVE) continue;
        const run = await tx.agentRun.create({
          data: {
            agentId: agent.id,
            conversationId,
            trigger: AgentRunTrigger.USER_MESSAGE,
            status: AgentRunStatus.QUEUED,
            triggerPayload: { messageId: message.id, authorId: userId }
          }
        });
        runs.push(run.id);
      }
      return { message, runs };
    });
    await Promise.all(result.runs.map((runId) => this.queue.enqueueRun(runId)));
    const mapped = toConversationMessage(result.message);
    await this.broadcastConversation(conversationId, "conversation.message", mapped);
    return mapped;
  }

  async markRead(userId: string, conversationId: string) {
    await this.assertAccess(userId, conversationId);
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, participantKind: ParticipantKind.USER, participantId: userId },
      data: { lastReadAt: new Date() }
    });
    return { ok: true };
  }

  async sendAgentMessage(input: {
    sourceAgentId: string;
    targetKind: ParticipantKind;
    targetId: string;
    content: string;
    conversationId?: string | null;
    runId?: string;
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.conversationMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return toConversationMessage(existing);
    }
    const source = await this.prisma.agent.findUnique({ where: { id: input.sourceAgentId } });
    if (!source) throw new NotFoundException("Source agent not found.");
    const parentRun = input.runId
      ? await this.prisma.agentRun.findUnique({ where: { id: input.runId }, select: { triggerPayload: true } })
      : null;
    const chainDepth = Number((parentRun?.triggerPayload as Record<string, unknown> | null)?.chainDepth ?? 0);
    const target = await this.resolveTarget(input.targetKind, input.targetId);
    const direct = input.conversationId
      ? null
      : await this.findDirect(ParticipantKind.AGENT, source.id, input.targetKind, input.targetId);
    if (input.targetKind === ParticipantKind.USER && input.targetId !== source.ownerId && !input.conversationId && !direct) {
      throw new ForbiddenException("An agent cannot initiate a first message to a user without an existing conversation.");
    }
    if (input.targetKind === ParticipantKind.AGENT) {
      const targetAgent = await this.prisma.agent.findUnique({ where: { id: input.targetId } });
      if (!targetAgent || (targetAgent.ownerId !== source.ownerId && targetAgent.visibility === AgentVisibility.PRIVATE)) {
        throw new ForbiddenException("Target agent is not available for cross-account messaging.");
      }
    }
    const conversation = input.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, include: { participants: true } })
      : direct
        ?? await this.prisma.conversation.create({
          data: {
            kind: input.targetKind === ParticipantKind.AGENT ? ConversationKind.AGENT_AGENT : ConversationKind.HUMAN_AGENT,
            title: input.targetKind === ParticipantKind.AGENT ? `${source.name} · ${target.label}` : source.name,
            createdByKind: ParticipantKind.AGENT,
            createdById: source.id,
            participants: {
              create: [
                { participantKind: ParticipantKind.AGENT, participantId: source.id, displayNameSnapshot: source.name },
                { participantKind: input.targetKind, participantId: input.targetId, displayNameSnapshot: target.label }
              ]
            }
          },
          include: { participants: true }
        });
    if (!conversation) throw new NotFoundException("Conversation not found.");
    if (input.conversationId) {
      const includesSource = conversation.participants.some((participant) =>
        participant.participantKind === ParticipantKind.AGENT && participant.participantId === source.id
      );
      const includesTarget = conversation.participants.some((participant) =>
        participant.participantKind === input.targetKind && participant.participantId === input.targetId
      );
      if (!includesSource || !includesTarget) {
        throw new ForbiddenException("Source and target must both belong to the conversation.");
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const message = await tx.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          idempotencyKey: input.idempotencyKey,
          authorKind: ParticipantKind.AGENT,
          authorId: source.id,
          content: input.content,
          metadata: input.runId ? { runId: input.runId } : undefined
        }
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
      const relationship = await tx.socialRelationship.upsert({
        where: {
          sourceAgentId_targetKind_targetId: {
            sourceAgentId: source.id,
            targetKind: input.targetKind,
            targetId: input.targetId
          }
        },
        create: {
          sourceAgentId: source.id,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetLabel: target.label,
          interactionCount: 1,
          familiarity: 0.05,
          lastInteractionAt: message.createdAt
        },
        update: {
          interactionCount: { increment: 1 },
          familiarity: { increment: 0.01 },
          lastInteractionAt: message.createdAt
        }
      });
      if (relationship.familiarity > 1) {
        await tx.socialRelationship.update({ where: { id: relationship.id }, data: { familiarity: 1 } });
      }
      await tx.agentEvent.create({
        data: {
          agentId: source.id,
          runId: input.runId,
          kind: AgentEventKind.MESSAGE,
          title: `Message sent to ${target.label}`,
          content: input.content.slice(0, 500)
        }
      });
      let targetRunId: string | undefined;
      if (input.targetKind === ParticipantKind.AGENT && chainDepth < 4) {
        const targetAgent = await tx.agent.findUnique({ where: { id: input.targetId } });
        if (targetAgent?.status === AgentStatus.ACTIVE) {
          const run = await tx.agentRun.create({
            data: {
              agentId: targetAgent.id,
              conversationId: conversation.id,
              trigger: AgentRunTrigger.AGENT_MESSAGE,
              status: AgentRunStatus.QUEUED,
              triggerPayload: { messageId: message.id, sourceAgentId: source.id, chainDepth: chainDepth + 1 }
            }
          });
          targetRunId = run.id;
        }
      }
      return { message, targetRunId };
    });
    if (result.targetRunId) await this.queue.enqueueRun(result.targetRunId);
    const mapped = toConversationMessage(result.message);
    await this.broadcastConversation(conversation.id, "conversation.message", mapped);
    return mapped;
  }

  private async broadcastConversation(conversationId: string, type: string, payload: unknown): Promise<void> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { participantKind: true, participantId: true }
    });
    const userIds = new Set<string>();
    for (const participant of participants) {
      if (participant.participantKind === ParticipantKind.USER) userIds.add(participant.participantId);
    }
    const agentIds = participants
      .filter((participant) => participant.participantKind === ParticipantKind.AGENT)
      .map((participant) => participant.participantId);
    if (agentIds.length) {
      const agents = await this.prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { ownerId: true }
      });
      for (const agent of agents) userIds.add(agent.ownerId);
    }
    this.realtime.emitToUsers(userIds, type, payload);
  }

  private async assertAccess(userId: string, conversationId: string) {
    const agentIds = (await this.prisma.agent.findMany({ where: { ownerId: userId }, select: { id: true } })).map((row) => row.id);
    const row = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          some: {
            OR: [
              { participantKind: ParticipantKind.USER, participantId: userId },
              ...(agentIds.length ? [{ participantKind: ParticipantKind.AGENT, participantId: { in: agentIds } }] : [])
            ]
          }
        }
      },
      include: { participants: true }
    });
    if (!row) throw new NotFoundException("Conversation not found.");
    return row;
  }

  private findDirect(aKind: ParticipantKind, aId: string, bKind: ParticipantKind, bId: string) {
    return this.prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { participantKind: aKind, participantId: aId } } },
          { participants: { some: { participantKind: bKind, participantId: bId } } }
        ]
      },
      include: { participants: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" }
    });
  }

  private async assertCanMessageAgents(userId: string, participants: Array<{ participantKind: ParticipantKind; participantId: string }>): Promise<void> {
    const agentIds = participants
      .filter((participant) => participant.participantKind === ParticipantKind.AGENT)
      .map((participant) => participant.participantId);
    if (!agentIds.length) return;
    const agents = await this.prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, ownerId: true, status: true, visibility: true }
    });
    const externalAgents = agents.filter((agent) => agent.ownerId !== userId);
    if (externalAgents.some((agent) => agent.status !== AgentStatus.ACTIVE || agent.visibility === AgentVisibility.PRIVATE)) {
      throw new ForbiddenException("An external agent is no longer available for messaging.");
    }
    const externalIds = externalAgents.map((agent) => agent.id);
    if (!externalIds.length) return;
    const contacts = await this.prisma.agentContact.count({ where: { userId, agentId: { in: externalIds } } });
    if (contacts !== externalIds.length) {
      throw new ForbiddenException("Add every external agent in this conversation as a contact before sending messages.");
    }
  }

  private async resolveTarget(kind: ParticipantKind, id: string): Promise<{ label: string }> {
    if (kind === ParticipantKind.AGENT) {
      const agent = await this.prisma.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException("Target agent not found.");
      return { label: agent.name };
    }
    if (kind === ParticipantKind.USER) {
      const user = await this.prisma.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException("Target user not found.");
      return { label: user.displayName };
    }
    return { label: "System" };
  }
}
