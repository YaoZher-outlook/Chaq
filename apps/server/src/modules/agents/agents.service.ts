import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AgentAutonomyMode,
  AgentEventKind,
  AgentGoalStatus,
  AgentMemoryKind,
  AgentPostReactionKind,
  AgentPostVisibility,
  AgentRunStatus,
  AgentRunTrigger,
  AgentStatus,
  AgentTaskStatus,
  AgentVisibility,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  ParticipantKind,
  Prisma,
  RelationshipKind,
  ToolRiskLevel
} from "@prisma/client";
import type { AgentDraft } from "@chaq/shared";
import { PrismaService } from "../../common/prisma.service";
import { UsersService } from "../users/users.service";
import { AgentQueueService } from "./agent-queue.service";
import {
  toAgentDetail,
  toAgentPost,
  toAgentSummary,
  toEvent,
  toGoal,
  toMemory,
  toPublicAgentSummary,
  toRelationship,
  toRun,
  toTask,
  toTool
} from "./agent-mappers";

type AgentUpdate = Partial<AgentDraft> & { status?: "draft" | "active" | "paused" | "archived" };

@Injectable()
export class AgentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AgentQueueService) private readonly queue: AgentQueueService
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.agent.findMany({
      where: { ownerId: userId, status: { not: AgentStatus.ARCHIVED } },
      include: {
        _count: { select: { goals: { where: { status: AgentGoalStatus.ACTIVE } } } },
        runs: { where: { status: { in: [AgentRunStatus.QUEUED, AgentRunStatus.RUNNING] } }, select: { status: true }, take: 1 }
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
    return rows.map(toAgentSummary);
  }

  async discover(userId: string, query?: string) {
    const value = query?.trim();
    const rows = await this.prisma.agent.findMany({
      where: {
        ownerId: { not: userId },
        status: AgentStatus.ACTIVE,
        visibility: AgentVisibility.PUBLIC,
        ...(value ? {
          OR: [
            { name: { contains: value, mode: "insensitive" } },
            { handle: { contains: value, mode: "insensitive" } },
            { tagline: { contains: value, mode: "insensitive" } },
            { tags: { has: value } }
          ]
        } : {})
      },
      include: {
        _count: { select: { goals: { where: { status: AgentGoalStatus.ACTIVE } } } },
        runs: { where: { status: { in: [AgentRunStatus.QUEUED, AgentRunStatus.RUNNING] } }, select: { status: true }, take: 1 }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100
    });
    return rows.map(toPublicAgentSummary);
  }

  async detail(userId: string, id: string) {
    const row = await this.prisma.agent.findFirst({
      where: { id, ownerId: userId },
      include: {
        _count: { select: { goals: { where: { status: AgentGoalStatus.ACTIVE } } } },
        knowledgeSources: { include: { _count: { select: { chunks: true } } }, orderBy: { updatedAt: "desc" }, take: 100 },
        memories: { orderBy: [{ salience: "desc" }, { updatedAt: "desc" }], take: 50 },
        relationships: { orderBy: [{ affinity: "desc" }, { updatedAt: "desc" }], take: 100 },
        goals: { orderBy: [{ status: "asc" }, { priority: "desc" }], take: 100 },
        tasks: { orderBy: [{ status: "asc" }, { priority: "desc" }], take: 100 },
        tools: { orderBy: { name: "asc" } },
        runs: { orderBy: { createdAt: "desc" }, take: 30 },
        events: { where: { visible: true }, orderBy: { createdAt: "desc" }, take: 100 }
      }
    });
    if (!row) throw new NotFoundException("Agent not found.");
    return toAgentDetail(row);
  }

  async profile(userId: string, id: string) {
    const access = await this.profileAccess(userId, id);
    const postVisibility = this.visiblePostWhere(access.isOwner, access.related);
    const [posts, postCount, relationshipCount, conversationCount, recentActivity] = await Promise.all([
      this.prisma.agentPost.findMany({
        where: { agentId: id, ...postVisibility },
        include: {
          _count: { select: { reactions: true, comments: true } },
          reactions: { where: { userId }, select: { id: true } },
          comments: {
            include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
            orderBy: { createdAt: "desc" },
            take: 20
          }
        },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 40
      }),
      this.prisma.agentPost.count({ where: { agentId: id, ...postVisibility } }),
      this.prisma.socialRelationship.count({ where: { sourceAgentId: id } }),
      this.prisma.conversationParticipant.count({ where: { participantKind: ParticipantKind.AGENT, participantId: id } }),
      this.prisma.agentEvent.findMany({
        where: {
          agentId: id,
          visible: true,
          kind: { in: [AgentEventKind.MESSAGE, AgentEventKind.GOAL, AgentEventKind.TASK, AgentEventKind.RELATIONSHIP] }
        },
        select: { id: true, kind: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 12
      })
    ]);
    const publicAgent = toPublicAgentSummary(access.agent);
    return {
      agent: {
        ...publicAgent,
        identity: access.agent.identity,
        values: access.agent.values,
        createdAt: access.agent.createdAt.toISOString()
      },
      owner: {
        displayName: access.agent.owner.displayName,
        avatarUrl: access.agent.owner.avatarUrl
      },
      isOwner: access.isOwner,
      stats: {
        posts: postCount,
        relationships: relationshipCount,
        conversations: conversationCount,
        daysActive: Math.max(1, Math.ceil((Date.now() - access.agent.createdAt.getTime()) / 86_400_000))
      },
      posts: posts.map(toAgentPost),
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        kind: event.kind.toLowerCase(),
        title: event.title,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }

  async createPost(userId: string, agentId: string, input: {
    content: string;
    mediaUrls?: string[];
    mood?: string;
    location?: string;
    visibility?: string;
  }) {
    await this.ownedAgent(userId, agentId);
    const post = await this.prisma.agentPost.create({
      data: {
        agentId,
        content: input.content,
        mediaUrls: input.mediaUrls ?? [],
        mood: input.mood ?? "",
        location: input.location ?? "",
        visibility: this.postVisibility(input.visibility ?? "public")
      }
    });
    await this.event(agentId, AgentEventKind.ACTION, "Shared a profile update", input.content.slice(0, 300));
    return this.post(userId, post.id);
  }

  async togglePostLike(userId: string, postId: string) {
    await this.assertPostAccess(userId, postId);
    const key = { postId_userId_kind: { postId, userId, kind: AgentPostReactionKind.LIKE } };
    const existing = await this.prisma.agentPostReaction.findUnique({ where: key });
    if (existing) {
      await this.prisma.agentPostReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.agentPostReaction.create({ data: { postId, userId, kind: AgentPostReactionKind.LIKE } });
    }
    return this.post(userId, postId);
  }

  async commentOnPost(userId: string, postId: string, content: string) {
    await this.assertPostAccess(userId, postId);
    await this.prisma.agentPostComment.create({ data: { postId, userId, content } });
    return this.post(userId, postId);
  }

  async deletePost(userId: string, agentId: string, postId: string) {
    await this.ownedAgent(userId, agentId);
    const deleted = await this.prisma.agentPost.deleteMany({ where: { id: postId, agentId } });
    if (!deleted.count) throw new NotFoundException("Profile post not found.");
    return { ok: true };
  }

  async create(userId: string, input: AgentDraft) {
    await this.users.ensureUser(userId);
    const handle = await this.uniqueHandle(userId, input.handle);
    const now = new Date();
    const snapshot = this.cleanJson({ ...input, handle });
    const agent = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          ownerId: userId,
          name: input.name,
          handle,
          avatarUrl: input.avatarUrl,
          coverUrl: input.coverUrl,
          tagline: input.tagline,
          biography: input.biography,
          profileStatus: input.profileStatus,
          mood: input.mood,
          persona: input.persona,
          tone: input.tone,
          values: input.values,
          worldview: input.worldview,
          boundaries: input.boundaries,
          identity: input.identity as unknown as Prisma.InputJsonValue,
          tags: input.tags,
          status: AgentStatus.ACTIVE,
          autonomyMode: this.autonomy(input.autonomyMode),
          visibility: this.visibility(input.visibility),
          modelProviderId: input.modelProviderId,
          model: input.model,
          temperature: input.temperature,
          initiative: input.initiative,
          reflectionDepth: input.reflectionDepth,
          scheduleEveryMinutes: input.scheduleEveryMinutes,
          nextRunAt: input.autonomyMode === "autonomous"
            ? new Date(now.getTime() + input.scheduleEveryMinutes * 60_000)
            : null,
          dailyTokenBudget: input.dailyTokenBudget,
          dailyActionBudget: input.dailyActionBudget
        }
      });
      await tx.agentVersion.create({ data: { agentId: created.id, version: 1, reason: "created", snapshot } });
      await tx.socialRelationship.create({
        data: {
          sourceAgentId: created.id,
          targetKind: ParticipantKind.USER,
          targetId: userId,
          targetLabel: "Owner",
          kind: RelationshipKind.OWNER,
          affinity: 0.8,
          trust: 1,
          familiarity: 0.8,
          notes: "The human who created and owns this agent."
        }
      });
      await tx.agentTool.createMany({ data: this.defaultTools(created.id) });
      await tx.agentEvent.create({
        data: {
          agentId: created.id,
          kind: AgentEventKind.SYSTEM,
          title: "Agent created",
          content: `${created.name} is ready to build memories and relationships.`
        }
      });
      return created;
    });
    return this.detail(userId, agent.id);
  }

  async update(userId: string, id: string, input: AgentUpdate) {
    const current = await this.ownedAgent(userId, id);
    const data: Prisma.AgentUpdateInput = {};
    const direct = [
      "name", "avatarUrl", "coverUrl", "tagline", "biography", "profileStatus", "mood", "persona", "tone", "values", "worldview", "boundaries",
      "tags", "model", "temperature", "initiative", "reflectionDepth", "scheduleEveryMinutes", "dailyTokenBudget",
      "dailyActionBudget"
    ] as const;
    for (const key of direct) {
      if (input[key] !== undefined) (data as any)[key] = input[key];
    }
    if (input.handle !== undefined) data.handle = await this.uniqueHandle(userId, input.handle, id);
    if (input.identity !== undefined) data.identity = input.identity as unknown as Prisma.InputJsonValue;
    if (input.modelProviderId !== undefined) {
      data.modelProvider = input.modelProviderId ? { connect: { id: input.modelProviderId } } : { disconnect: true };
    }
    if (input.autonomyMode !== undefined) data.autonomyMode = this.autonomy(input.autonomyMode);
    if (input.visibility !== undefined) data.visibility = this.visibility(input.visibility);
    if (input.status !== undefined) data.status = this.status(input.status);
    const nextMode = input.autonomyMode ?? current.autonomyMode.toLowerCase();
    if (nextMode === "autonomous" && (!current.nextRunAt || input.scheduleEveryMinutes !== undefined)) {
      data.nextRunAt = new Date(Date.now() + (input.scheduleEveryMinutes ?? current.scheduleEveryMinutes) * 60_000);
    } else if (nextMode !== "autonomous") {
      data.nextRunAt = null;
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agent.update({ where: { id }, data });
      const max = await tx.agentVersion.aggregate({ where: { agentId: id }, _max: { version: true } });
      await tx.agentVersion.create({
        data: {
          agentId: id,
          version: (max._max.version ?? 0) + 1,
          reason: "profile_updated",
          snapshot: this.cleanJson(updated)
        }
      });
    });
    return this.detail(userId, id);
  }

  async migrateSkill(userId: string, skillId: string) {
    const existing = await this.prisma.agent.findUnique({ where: { legacySkillId: skillId } });
    if (existing) return this.detail(userId, existing.id);
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, ownerId: userId } });
    if (!skill) throw new NotFoundException("Skill not found.");
    const identity = {
      traits: skill.tags,
      interests: skill.tags,
      background: skill.description,
      communicationStyle: skill.tone
    };
    const created = await this.create(userId, {
      name: skill.name,
      handle: this.slug(skill.name),
      avatarUrl: skill.avatarUrl,
      tagline: skill.description,
      biography: skill.description,
      persona: skill.persona,
      tone: skill.tone,
      values: [],
      worldview: "",
      boundaries: skill.boundaries,
      identity,
      tags: skill.tags,
      autonomyMode: "copilot",
      visibility: skill.visibility === "PUBLIC" ? "public" : "private",
      modelProviderId: null,
      model: null,
      temperature: 0.7,
      initiative: 55,
      reflectionDepth: 2,
      scheduleEveryMinutes: 60,
      dailyTokenBudget: 5000,
      dailyActionBudget: 30
    });
    await this.prisma.agent.update({ where: { id: created.id }, data: { legacySkillId: skill.id } });
    if (skill.knowledge.trim()) {
      await this.addKnowledge(userId, created.id, {
        kind: "skill_migration",
        title: `${skill.name} knowledge`,
        content: skill.knowledge,
        originUri: null,
        metadata: { legacySkillId: skill.id }
      });
    }
    return this.detail(userId, created.id);
  }

  async addMemory(userId: string, agentId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const row = await this.prisma.agentMemory.create({
      data: {
        agentId,
        kind: AgentMemoryKind[input.kind.toUpperCase() as keyof typeof AgentMemoryKind],
        content: input.content,
        summary: input.summary,
        salience: input.salience,
        confidence: input.confidence,
        emotionalValence: input.emotionalValence,
        keywords: input.keywords,
        sourceType: input.sourceType,
        sourceId: input.sourceId
      }
    });
    await this.event(agentId, AgentEventKind.MEMORY, "Memory added", row.summary || row.content.slice(0, 180));
    return toMemory(row);
  }

  async upsertRelationship(userId: string, agentId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const data = {
      targetLabel: input.targetLabel,
      kind: RelationshipKind[input.kind.toUpperCase() as keyof typeof RelationshipKind],
      customKind: input.customKind,
      affinity: input.affinity,
      trust: input.trust,
      familiarity: input.familiarity,
      sentiment: input.sentiment,
      notes: input.notes
    };
    const targetKind = ParticipantKind[input.targetKind.toUpperCase() as keyof typeof ParticipantKind];
    const row = await this.prisma.socialRelationship.upsert({
      where: { sourceAgentId_targetKind_targetId: { sourceAgentId: agentId, targetKind, targetId: input.targetId } },
      create: { sourceAgentId: agentId, targetKind, targetId: input.targetId, ...data },
      update: data
    });
    await this.event(agentId, AgentEventKind.RELATIONSHIP, "Relationship updated", `${row.targetLabel}: ${row.kind.toLowerCase()}`);
    return toRelationship(row);
  }

  async addGoal(userId: string, agentId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const row = await this.prisma.agentGoal.create({
      data: {
        agentId,
        parentGoalId: input.parentGoalId,
        title: input.title,
        description: input.description,
        status: AgentGoalStatus[input.status.toUpperCase() as keyof typeof AgentGoalStatus],
        priority: input.priority,
        progress: input.progress,
        success: input.success,
        dueAt: input.dueAt ? new Date(input.dueAt) : null
      }
    });
    await this.event(agentId, AgentEventKind.GOAL, "Goal created", row.title);
    return toGoal(row);
  }

  async updateGoal(userId: string, agentId: string, goalId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const changed = await this.prisma.agentGoal.updateMany({
      where: { id: goalId, agentId },
      data: {
        parentGoalId: input.parentGoalId,
        title: input.title,
        description: input.description,
        status: input.status ? AgentGoalStatus[input.status.toUpperCase() as keyof typeof AgentGoalStatus] : undefined,
        priority: input.priority,
        progress: input.progress,
        success: input.success,
        dueAt: input.dueAt === null ? null : input.dueAt ? new Date(input.dueAt) : undefined,
        completedAt: input.status === "completed" ? new Date() : input.status ? null : undefined
      }
    });
    if (!changed.count) throw new NotFoundException("Goal not found.");
    const row = await this.prisma.agentGoal.findUniqueOrThrow({ where: { id: goalId } });
    await this.event(agentId, AgentEventKind.GOAL, "Goal updated", `${row.title}: ${row.status.toLowerCase()}`);
    return toGoal(row);
  }

  async addTask(userId: string, agentId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const row = await this.prisma.agentTask.create({
      data: {
        agentId,
        goalId: input.goalId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null
      }
    });
    await this.event(agentId, AgentEventKind.TASK, "Task created", row.title);
    return toTask(row);
  }

  async updateTask(userId: string, agentId: string, taskId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const status = input.status ? AgentTaskStatus[input.status.toUpperCase() as keyof typeof AgentTaskStatus] : undefined;
    const changed = await this.prisma.agentTask.updateMany({
      where: { id: taskId, agentId },
      data: {
        title: input.title,
        description: input.description,
        status,
        priority: input.priority,
        scheduledFor: input.scheduledFor === null ? null : input.scheduledFor ? new Date(input.scheduledFor) : undefined,
        startedAt: status === AgentTaskStatus.RUNNING ? new Date() : undefined,
        completedAt: status === AgentTaskStatus.COMPLETED ? new Date() : status ? null : undefined
      }
    });
    if (!changed.count) throw new NotFoundException("Task not found.");
    const row = await this.prisma.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await this.event(agentId, AgentEventKind.TASK, "Task updated", `${row.title}: ${row.status.toLowerCase()}`);
    return toTask(row);
  }

  async updateTool(userId: string, agentId: string, toolId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const changed = await this.prisma.agentTool.updateMany({
      where: { id: toolId, agentId },
      data: {
        enabled: input.enabled,
        riskLevel: input.riskLevel ? ToolRiskLevel[input.riskLevel.toUpperCase() as keyof typeof ToolRiskLevel] : undefined,
        config: input.config === null ? Prisma.JsonNull : input.config as Prisma.InputJsonValue | undefined,
        permissions: input.permissions === null ? Prisma.JsonNull : input.permissions as Prisma.InputJsonValue | undefined
      }
    });
    if (!changed.count) throw new NotFoundException("Tool not found.");
    const row = await this.prisma.agentTool.findUniqueOrThrow({ where: { id: toolId } });
    await this.event(agentId, AgentEventKind.SYSTEM, "Tool updated", `${row.name}: ${row.enabled ? "enabled" : "disabled"}`);
    return toTool(row);
  }

  async addKnowledge(userId: string, agentId: string, input: any) {
    await this.ownedAgent(userId, agentId);
    const chunks = this.chunkText(input.content);
    const hash = createHash("sha256").update(input.content).digest("hex");
    const row = await this.prisma.agentKnowledgeSource.create({
      data: {
        agentId,
        kind: KnowledgeSourceKind[input.kind.toUpperCase() as keyof typeof KnowledgeSourceKind],
        status: KnowledgeSourceStatus.READY,
        title: input.title,
        originUri: input.originUri,
        contentHash: hash,
        summary: input.content.slice(0, 500),
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        chunks: {
          create: chunks.map((content, position) => ({
            position,
            content,
            tokenCount: Math.ceil(content.length / 4),
            keywords: this.keywords(content)
          }))
        }
      },
      include: { _count: { select: { chunks: true } } }
    });
    await this.event(agentId, AgentEventKind.MEMORY, "Knowledge indexed", `${row.title}: ${row._count.chunks} chunks`);
    return {
      id: row.id,
      agentId: row.agentId,
      kind: row.kind.toLowerCase(),
      status: row.status.toLowerCase(),
      title: row.title,
      summary: row.summary,
      chunkCount: row._count.chunks,
      createdAt: row.createdAt.toISOString()
    };
  }

  async runNow(userId: string, agentId: string, conversationId?: string) {
    const agent = await this.ownedAgent(userId, agentId);
    if (agent.status !== AgentStatus.ACTIVE) throw new BadRequestException("Agent must be active before it can run.");
    const row = await this.prisma.agentRun.create({
      data: { agentId, conversationId, trigger: AgentRunTrigger.MANUAL, status: AgentRunStatus.QUEUED }
    });
    await this.queue.enqueueRun(row.id);
    return toRun(row);
  }

  async activity(userId: string, agentId?: string) {
    const rows = await this.prisma.agentEvent.findMany({
      where: { visible: true, agent: { ownerId: userId }, ...(agentId ? { agentId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return rows.map(toEvent);
  }

  private async ownedAgent(userId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, ownerId: userId } });
    if (!agent) throw new NotFoundException("Agent not found.");
    return agent;
  }

  private async profileAccess(userId: string, id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        owner: { select: { displayName: true, avatarUrl: true } },
        runs: {
          where: { status: { in: [AgentRunStatus.QUEUED, AgentRunStatus.RUNNING] } },
          select: { status: true },
          take: 1
        }
      }
    });
    if (!agent) throw new NotFoundException("Agent profile not found.");
    const isOwner = agent.ownerId === userId;
    if (!isOwner && (agent.visibility === AgentVisibility.PRIVATE || agent.status === AgentStatus.ARCHIVED)) {
      throw new NotFoundException("Agent profile not found.");
    }
    const related = isOwner || Boolean(await this.prisma.socialRelationship.findFirst({
      where: { sourceAgentId: id, targetKind: ParticipantKind.USER, targetId: userId },
      select: { id: true }
    }));
    return { agent, isOwner, related };
  }

  private visiblePostWhere(isOwner: boolean, related: boolean): Prisma.AgentPostWhereInput {
    if (isOwner) return {};
    return { visibility: { in: related ? [AgentPostVisibility.PUBLIC, AgentPostVisibility.RELATIONSHIPS] : [AgentPostVisibility.PUBLIC] } };
  }

  private async assertPostAccess(userId: string, postId: string) {
    const post = await this.prisma.agentPost.findUnique({ where: { id: postId }, select: { id: true, agentId: true, visibility: true } });
    if (!post) throw new NotFoundException("Profile post not found.");
    const access = await this.profileAccess(userId, post.agentId);
    if (!access.isOwner && post.visibility === AgentPostVisibility.PRIVATE) throw new NotFoundException("Profile post not found.");
    if (!access.isOwner && post.visibility === AgentPostVisibility.RELATIONSHIPS && !access.related) {
      throw new NotFoundException("Profile post not found.");
    }
    return post;
  }

  private async post(userId: string, postId: string) {
    await this.assertPostAccess(userId, postId);
    const row = await this.prisma.agentPost.findUniqueOrThrow({
      where: { id: postId },
      include: {
        _count: { select: { reactions: true, comments: true } },
        reactions: { where: { userId }, select: { id: true } },
        comments: {
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
          orderBy: { createdAt: "desc" },
          take: 20
        }
      }
    });
    return toAgentPost(row);
  }

  private async uniqueHandle(userId: string, raw: string, excludeId?: string): Promise<string> {
    const base = this.slug(raw);
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const handle = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const existing = await this.prisma.agent.findFirst({
        where: { ownerId: userId, handle, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true }
      });
      if (!existing) return handle;
    }
    throw new BadRequestException("Could not create a unique agent handle.");
  }

  private slug(value: string): string {
    const result = value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return result || `agent-${Date.now().toString(36)}`;
  }

  private autonomy(value: string): AgentAutonomyMode {
    return AgentAutonomyMode[value.toUpperCase() as keyof typeof AgentAutonomyMode];
  }

  private visibility(value: string): AgentVisibility {
    return AgentVisibility[value.toUpperCase() as keyof typeof AgentVisibility];
  }

  private postVisibility(value: string): AgentPostVisibility {
    return AgentPostVisibility[value.toUpperCase() as keyof typeof AgentPostVisibility];
  }

  private status(value: string): AgentStatus {
    return AgentStatus[value.toUpperCase() as keyof typeof AgentStatus];
  }

  private defaultTools(agentId: string) {
    return [
      { agentId, name: "send_message", description: "Send a message to the owner or another agent." },
      { agentId, name: "remember", description: "Store an important long-term memory." },
      { agentId, name: "search_knowledge", description: "Search the agent knowledge base." },
      { agentId, name: "manage_goal", description: "Create or update a personal goal." },
      { agentId, name: "manage_task", description: "Create or complete a concrete task." },
      { agentId, name: "publish_profile_post", description: "Share a short update on the agent profile." },
      { agentId, name: "wait", description: "Schedule the next autonomous wake-up." }
    ];
  }

  private chunkText(content: string): string[] {
    const normalized = content.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];
    const chunks: string[] = [];
    let start = 0;
    while (start < normalized.length) {
      let end = Math.min(normalized.length, start + 1_600);
      if (end < normalized.length) {
        const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf("。", end));
        if (boundary > start + 800) end = boundary + 1;
      }
      chunks.push(normalized.slice(start, end).trim());
      if (end >= normalized.length) break;
      start = Math.max(start + 1, end - 160);
    }
    return chunks.filter(Boolean);
  }

  private keywords(content: string): string[] {
    const matches = content.toLowerCase().match(/[\p{Script=Han}]{2,8}|[a-z0-9][a-z0-9_-]{2,}/gu) ?? [];
    return [...new Set(matches)].slice(0, 40);
  }

  private cleanJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async event(agentId: string, kind: AgentEventKind, title: string, content: string): Promise<void> {
    await this.prisma.agentEvent.create({ data: { agentId, kind, title, content } });
  }
}
