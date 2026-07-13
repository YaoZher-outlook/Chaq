import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DistillationStatus, Prisma, ReactionTarget, ReactionValue, SkillSourceKind, SkillVisibility } from "@prisma/client";
import type { MarketplaceComment, MarketplaceSkill, SkillDraft } from "@chaq/shared";
import { PrismaService } from "../../common/prisma.service";
import { UsersService } from "../users/users.service";

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService
  ) {}

  async list(input: { query?: string; tag?: string }): Promise<MarketplaceSkill[]> {
    const where: Prisma.MarketplaceSkillWhereInput = {};
    if (input.query?.trim()) {
      const query = input.query.trim();
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { tags: { has: query } }
      ];
    }
    if (input.tag?.trim()) {
      where.tags = { has: input.tag.trim() };
    }

    const rows = await this.prisma.marketplaceSkill.findMany({
      where,
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
      take: 100
    });
    return rows.map((row) => this.toMarketplaceSkill(row));
  }

  async detail(id: string) {
    const row = await this.prisma.marketplaceSkill.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Marketplace skill not found.");
    }
    return {
      ...this.toMarketplaceSkill(row),
      persona: row.persona,
      tone: row.tone,
      knowledge: row.knowledge,
      boundaries: row.boundaries,
      examples: row.examples
    };
  }

  async publish(userId: string, input: { skill: SkillDraft; sourceKind: string }): Promise<MarketplaceSkill> {
    await this.users.ensureUser(userId);
    const sourceKind = this.toSourceKind(input.sourceKind);
    const row = await this.prisma.$transaction(async (tx) => {
      const skill = await tx.skill.create({
        data: {
          ownerId: userId,
          visibility: SkillVisibility.PUBLIC,
          name: input.skill.name,
          avatarUrl: input.skill.avatarUrl,
          description: input.skill.description,
          persona: input.skill.persona,
          tone: input.skill.tone,
          knowledge: input.skill.knowledge,
          boundaries: input.skill.boundaries,
          examples: input.skill.examples as unknown as Prisma.InputJsonValue,
          tags: input.skill.tags
        }
      });
      const version = await tx.skillVersion.create({
        data: {
          skillId: skill.id,
          version: 1,
          sourceKind,
          status: DistillationStatus.CONFIRMED,
          name: input.skill.name,
          avatarUrl: input.skill.avatarUrl,
          description: input.skill.description,
          persona: input.skill.persona,
          tone: input.skill.tone,
          knowledge: input.skill.knowledge,
          boundaries: input.skill.boundaries,
          examples: input.skill.examples as unknown as Prisma.InputJsonValue,
          tags: input.skill.tags
        }
      });
      await tx.skill.update({
        where: { id: skill.id },
        data: { activeVersionId: version.id }
      });
      return tx.marketplaceSkill.create({
        data: {
          skillId: skill.id,
          versionId: version.id,
          publisherId: userId,
          name: input.skill.name,
          avatarUrl: input.skill.avatarUrl,
          description: input.skill.description,
          persona: input.skill.persona,
          tone: input.skill.tone,
          knowledge: input.skill.knowledge,
          boundaries: input.skill.boundaries,
          examples: input.skill.examples as unknown as Prisma.InputJsonValue,
          tags: input.skill.tags
        }
      });
    });
    return this.toMarketplaceSkill(row);
  }

  async importSkill(userId: string, id: string) {
    await this.users.ensureUser(userId);
    const row = await this.prisma.marketplaceSkill.update({
      where: { id },
      data: { importCount: { increment: 1 } }
    });
    return {
      sourceMarketplaceSkillId: id,
      skill: {
        name: row.name,
        avatarUrl: row.avatarUrl,
        description: row.description,
        persona: row.persona,
        tone: row.tone,
        knowledge: row.knowledge,
        boundaries: row.boundaries,
        examples: row.examples as unknown as SkillDraft["examples"],
        tags: row.tags
      } satisfies SkillDraft
    };
  }

  async reportSkill(userId: string, marketplaceSkillId: string, reason: string) {
    await this.users.ensureUser(userId);
    const row = await this.prisma.marketplaceSkill.findUnique({
      where: { id: marketplaceSkillId },
      include: { skill: { select: { ownerId: true } } }
    });
    if (!row) throw new NotFoundException("Marketplace skill not found.");
    if (row.skill.ownerId === userId) throw new ForbiddenException("Cannot report your own skill.");
    await this.prisma.skillReport.create({
      data: {
        reporterId: userId,
        skillId: row.skillId,
        reason: reason.trim() || "user_report"
      }
    });
    return { ok: true };
  }

  async reactToSkill(userId: string, marketplaceSkillId: string, value: "up" | "down") {
    await this.users.ensureUser(userId);
    await this.setReaction(userId, ReactionTarget.SKILL, marketplaceSkillId, this.toReactionValue(value));
    const row = await this.prisma.marketplaceSkill.findUnique({ where: { id: marketplaceSkillId } });
    if (!row) {
      throw new NotFoundException("Marketplace skill not found.");
    }
    return this.toMarketplaceSkill(row);
  }

  async toggleFavorite(userId: string, marketplaceSkillId: string) {
    await this.users.ensureUser(userId);
    return this.serializableTransaction(async (tx) => {
      const target = await tx.marketplaceSkill.findUnique({ where: { id: marketplaceSkillId }, select: { id: true } });
      if (!target) throw new NotFoundException("Marketplace skill not found.");
      const existing = await tx.favorite.findUnique({
        where: { userId_marketplaceSkillId: { userId, marketplaceSkillId } }
      });
      if (existing) {
        await tx.favorite.delete({ where: { id: existing.id } });
      } else {
        await tx.favorite.create({ data: { userId, marketplaceSkillId } });
      }
      const favorites = await tx.favorite.count({ where: { marketplaceSkillId } });
      await tx.marketplaceSkill.update({ where: { id: marketplaceSkillId }, data: { favorites } });
      return { favorited: !existing };
    });
  }

  async comments(marketplaceSkillId: string): Promise<MarketplaceComment[]> {
    const rows = await this.prisma.comment.findMany({
      where: { marketplaceSkillId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return rows.map((row) => ({
      id: row.id,
      marketplaceSkillId: row.marketplaceSkillId,
      displayName: "匿名用户",
      content: row.content,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async addComment(userId: string, marketplaceSkillId: string, content: string): Promise<MarketplaceComment> {
    await this.users.ensureUser(userId);
    const row = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { userId, marketplaceSkillId, content }
      });
      await tx.marketplaceSkill.update({
        where: { id: marketplaceSkillId },
        data: { commentCount: { increment: 1 } }
      });
      return comment;
    });
    return {
      id: row.id,
      marketplaceSkillId: row.marketplaceSkillId,
      displayName: "匿名用户",
      content: row.content,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      createdAt: row.createdAt.toISOString()
    };
  }

  async reactToComment(userId: string, commentId: string, value: "up" | "down") {
    await this.users.ensureUser(userId);
    await this.setReaction(userId, ReactionTarget.COMMENT, commentId, this.toReactionValue(value));
    const row = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!row) {
      throw new NotFoundException("Comment not found.");
    }
    return {
      id: row.id,
      marketplaceSkillId: row.marketplaceSkillId,
      displayName: "匿名用户",
      content: row.content,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      createdAt: row.createdAt.toISOString()
    } satisfies MarketplaceComment;
  }

  private async setReaction(userId: string, target: ReactionTarget, targetId: string, value: ReactionValue): Promise<void> {
    await this.serializableTransaction(async (tx) => {
      const targetRow = target === ReactionTarget.SKILL
        ? await tx.marketplaceSkill.findUnique({ where: { id: targetId }, select: { id: true } })
        : await tx.comment.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!targetRow) {
        throw new NotFoundException(target === ReactionTarget.SKILL ? "Marketplace skill not found." : "Comment not found.");
      }
      const existing = await tx.reaction.findUnique({
        where: { userId_target_targetId: { userId, target, targetId } }
      });
      if (existing?.value === value) {
        await tx.reaction.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.reaction.update({ where: { id: existing.id }, data: { value } });
      } else {
        await tx.reaction.create({ data: { userId, target, targetId, value } });
      }

      const [upvotes, downvotes] = await Promise.all([
        tx.reaction.count({ where: { target, targetId, value: ReactionValue.UP } }),
        tx.reaction.count({ where: { target, targetId, value: ReactionValue.DOWN } })
      ]);
      if (target === ReactionTarget.SKILL) {
        await tx.marketplaceSkill.update({
          where: { id: targetId },
          data: { upvotes, downvotes }
        });
      } else {
        await tx.comment.update({
          where: { id: targetId },
          data: { upvotes, downvotes }
        });
      }
    });
  }

  private async serializableTransaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(action, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (!this.isRetryableTransactionError(error) || attempt === 3) throw error;
      }
    }
    throw new ConflictException("Could not serialize marketplace update.");
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("code" in error)) return false;
    return ["P2002", "P2025", "P2034"].includes(String((error as { code?: unknown }).code));
  }

  private toMarketplaceSkill(row: {
    id: string;
    skillId: string;
    versionId: string;
    publisherId: string;
    name: string;
    description: string;
    avatarUrl: string | null;
    tags: string[];
    upvotes: number;
    downvotes: number;
    favorites: number;
    importCount: number;
    commentCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): MarketplaceSkill {
    return {
      id: row.id,
      skillId: row.skillId,
      versionId: row.versionId,
      publisherId: row.publisherId,
      name: row.name,
      description: row.description,
      avatarUrl: row.avatarUrl,
      tags: row.tags,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      favorites: row.favorites,
      importCount: row.importCount,
      commentCount: row.commentCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toReactionValue(value: "up" | "down"): ReactionValue {
    return value === "up" ? ReactionValue.UP : ReactionValue.DOWN;
  }

  private toSourceKind(kind: string): SkillSourceKind {
    return SkillSourceKind[kind.toUpperCase() as keyof typeof SkillSourceKind] ?? SkillSourceKind.MANUAL;
  }
}
