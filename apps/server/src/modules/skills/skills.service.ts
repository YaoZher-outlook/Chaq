import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DistillationStatus, Prisma, ReactionTarget, SkillReportStatus, SkillSourceKind, SkillVisibility } from "@prisma/client";
import type { DistillRequest, SkillDraft, SkillReviewItem, SkillSummary, SkillVersionSnapshot } from "@chaq/shared";
import { PrismaService } from "../../common/prisma.service";
import { ModelsService } from "../models/models.service";
import { UsersService } from "../users/users.service";

@Injectable()
export class SkillsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(ModelsService) private readonly models: ModelsService
  ) {}

  async listSkills(userId: string): Promise<SkillSummary[]> {
    await this.users.ensureUser(userId);
    const rows = await this.prisma.skill.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((row) => this.toSkillSummary(row));
  }

  async getSkill(userId: string, id: string): Promise<SkillSummary> {
    const row = await this.prisma.skill.findFirst({ where: { id, ownerId: userId } });
    if (!row) throw new NotFoundException("Skill not found.");
    return this.toSkillSummary(row);
  }

  async createSkill(userId: string, skill: SkillDraft, sourceKindInput: string): Promise<SkillSummary> {
    await this.users.ensureUser(userId);
    const sourceKind = this.toSourceKind(sourceKindInput);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.skill.create({
        data: {
          ownerId: userId,
          visibility: SkillVisibility.PRIVATE,
          name: skill.name,
          avatarUrl: skill.avatarUrl,
          description: skill.description,
          persona: skill.persona,
          tone: skill.tone,
          knowledge: skill.knowledge,
          boundaries: skill.boundaries,
          examples: skill.examples as unknown as Prisma.InputJsonValue,
          tags: skill.tags
        }
      });
      const version = await tx.skillVersion.create({
        data: {
          skillId: created.id,
          version: 1,
          sourceKind,
          status: DistillationStatus.CONFIRMED,
          name: skill.name,
          avatarUrl: skill.avatarUrl,
          description: skill.description,
          persona: skill.persona,
          tone: skill.tone,
          knowledge: skill.knowledge,
          boundaries: skill.boundaries,
          examples: skill.examples as unknown as Prisma.InputJsonValue,
          tags: skill.tags
        }
      });
      return tx.skill.update({
        where: { id: created.id },
        data: { activeVersionId: version.id }
      });
    });

    return this.toSkillSummary(row);
  }

  async updateSkill(userId: string, id: string, skill: SkillDraft, sourceKindInput: string): Promise<SkillSummary> {
    const existing = await this.prisma.skill.findFirst({ where: { id, ownerId: userId } });
    if (!existing) throw new NotFoundException("Skill not found.");
    const sourceKind = this.toSourceKind(sourceKindInput);
    const row = await this.prisma.$transaction(async (tx) => {
      const max = await tx.skillVersion.aggregate({ where: { skillId: id }, _max: { version: true } });
      const updated = await tx.skill.update({
        where: { id },
        data: {
          name: skill.name,
          avatarUrl: skill.avatarUrl,
          description: skill.description,
          persona: skill.persona,
          tone: skill.tone,
          knowledge: skill.knowledge,
          boundaries: skill.boundaries,
          examples: skill.examples as unknown as Prisma.InputJsonValue,
          tags: skill.tags
        }
      });
      const version = await tx.skillVersion.create({
        data: {
          skillId: id,
          version: (max._max.version ?? 0) + 1,
          sourceKind,
          status: DistillationStatus.CONFIRMED,
          name: skill.name,
          avatarUrl: skill.avatarUrl,
          description: skill.description,
          persona: skill.persona,
          tone: skill.tone,
          knowledge: skill.knowledge,
          boundaries: skill.boundaries,
          examples: skill.examples as unknown as Prisma.InputJsonValue,
          tags: skill.tags
        }
      });
      return tx.skill.update({ where: { id: updated.id }, data: { activeVersionId: version.id } });
    });
    return this.toSkillSummary(row);
  }

  async deleteSkill(userId: string, id: string): Promise<{ ok: true }> {
    const deleted = await this.prisma.skill.deleteMany({ where: { id, ownerId: userId } });
    if (!deleted.count) throw new NotFoundException("Skill not found.");
    return { ok: true };
  }

  async listVersions(userId: string, skillId: string): Promise<SkillVersionSnapshot[]> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, ownerId: userId }, select: { id: true } });
    if (!skill) throw new NotFoundException("Skill not found.");
    const rows = await this.prisma.skillVersion.findMany({
      where: { skillId },
      orderBy: { version: "desc" }
    });
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skillId,
      version: row.version,
      sourceKind: row.sourceKind.toLowerCase() as SkillVersionSnapshot["sourceKind"],
      status: row.status.toLowerCase() as SkillVersionSnapshot["status"],
      name: row.name,
      avatarUrl: row.avatarUrl,
      description: row.description,
      persona: row.persona,
      tone: row.tone,
      knowledge: row.knowledge,
      boundaries: row.boundaries,
      examples: row.examples as unknown as SkillDraft["examples"],
      tags: row.tags,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async logSource(
    userId: string,
    input: {
      skillId?: string;
      kind: string;
      fileName: string;
      messageCount: number;
      rawPreview?: unknown;
    }
  ) {
    await this.users.ensureUser(userId);
    return this.prisma.skillSource.create({
      data: {
        userId,
        skillId: input.skillId,
        kind: this.toSourceKind(input.kind),
        fileName: input.fileName,
        messageCount: input.messageCount,
        rawPreview: input.rawPreview as object | undefined
      }
    });
  }

  async distill(userId: string, input: DistillRequest) {
    await this.users.ensureUser(userId);
    return this.models.distill(userId, input);
  }

  async reportSkill(userId: string, skillId: string, reason: string) {
    await this.users.ensureUser(userId);
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      select: { id: true, ownerId: true, visibility: true }
    });
    if (!skill) {
      throw new NotFoundException("Skill not found.");
    }
    if (skill.ownerId === userId) {
      throw new ForbiddenException("Cannot report your own skill.");
    }
    if (skill.visibility !== SkillVisibility.PUBLIC) {
      throw new NotFoundException("Skill not found.");
    }
    await this.prisma.skillReport.create({
      data: {
        reporterId: userId,
        skillId,
        reason: reason.trim() || "user_report"
      }
    });
    return { ok: true };
  }

  async adminReviewQueue(adminUserId: string): Promise<SkillReviewItem[]> {
    await this.users.assertAdmin(adminUserId);
    const rows = await this.prisma.skillReport.findMany({
      where: { status: SkillReportStatus.PENDING },
      include: {
        reporter: { select: { displayName: true, username: true } },
        skill: {
          include: {
            owner: { select: { displayName: true } },
            marketplace: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: 500
    });
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.skillId) ?? [];
      list.push(row);
      grouped.set(row.skillId, list);
    }
    return [...grouped.values()].map((reports) => {
      const sorted = [...reports].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      const latest = sorted[sorted.length - 1];
      const skill = latest.skill;
      const marketplace = skill.marketplace;
      return {
        skill: {
          id: marketplace?.id ?? skill.id,
          skillId: skill.id,
          versionId: marketplace?.versionId ?? skill.activeVersionId ?? "",
          publisherId: marketplace?.publisherId ?? skill.ownerId,
          ownerId: skill.ownerId,
          ownerDisplayName: skill.owner?.displayName ?? skill.ownerId,
          visibility: skill.visibility.toLowerCase() as SkillReviewItem["skill"]["visibility"],
          name: marketplace?.name ?? skill.name,
          description: marketplace?.description ?? skill.description,
          avatarUrl: marketplace?.avatarUrl ?? skill.avatarUrl,
          tags: marketplace?.tags ?? skill.tags,
          upvotes: marketplace?.upvotes ?? 0,
          downvotes: marketplace?.downvotes ?? 0,
          favorites: marketplace?.favorites ?? 0,
          importCount: marketplace?.importCount ?? 0,
          commentCount: marketplace?.commentCount ?? 0,
          createdAt: (marketplace?.createdAt ?? skill.createdAt).toISOString(),
          updatedAt: (marketplace?.updatedAt ?? skill.updatedAt).toISOString()
        },
        reportCount: sorted.length,
        latestReason: latest.reason,
        latestReporter: latest.reporter?.displayName ?? latest.reporter?.username ?? latest.reporterId,
        oldestReportAt: sorted[0].createdAt.toISOString(),
        latestReportAt: latest.createdAt.toISOString(),
        status: "pending"
      } satisfies SkillReviewItem;
    }).sort((left, right) => right.reportCount - left.reportCount || left.oldestReportAt.localeCompare(right.oldestReportAt));
  }

  async moderateSkill(adminUserId: string, skillId: string, action: "dismiss" | "unpublish" | "archive", note = "") {
    await this.users.assertAdmin(adminUserId);
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      include: { marketplace: { select: { id: true } } }
    });
    if (!skill) throw new NotFoundException("Skill not found.");
    await this.prisma.$transaction(async (tx) => {
      if (action === "unpublish" || action === "archive") {
        await tx.skill.update({
          where: { id: skillId },
          data: { visibility: SkillVisibility.PRIVATE }
        });
        if (skill.marketplace) {
          const commentIds = await tx.comment.findMany({
            where: { marketplaceSkillId: skill.marketplace.id },
            select: { id: true }
          });
          await tx.reaction.deleteMany({
            where: {
              OR: [
                { target: ReactionTarget.SKILL, targetId: skill.marketplace.id },
                { target: ReactionTarget.COMMENT, targetId: { in: commentIds.map((comment) => comment.id) } }
              ]
            }
          });
          await tx.marketplaceSkill.delete({ where: { id: skill.marketplace.id } });
        }
      }
      await tx.skillReport.updateMany({
        where: { skillId, status: SkillReportStatus.PENDING },
        data: {
          status: action === "dismiss" ? SkillReportStatus.DISMISSED : SkillReportStatus.ACTIONED,
          adminNote: note,
          reviewedById: adminUserId,
          reviewedAt: new Date()
        }
      });
    });
    return { ok: true };
  }

  private toSourceKind(kind: string): SkillSourceKind {
    return SkillSourceKind[kind.toUpperCase() as keyof typeof SkillSourceKind] ?? SkillSourceKind.MANUAL;
  }

  private toSkillSummary(row: {
    id: string;
    ownerId: string;
    visibility: SkillVisibility;
    activeVersionId: string | null;
    name: string;
    avatarUrl: string | null;
    description: string;
    persona: string;
    tone: string;
    knowledge: string;
    boundaries: string;
    examples: Prisma.JsonValue;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
  }): SkillSummary {
    return {
      id: row.id,
      ownerId: row.ownerId,
      visibility: row.visibility.toLowerCase() as SkillSummary["visibility"],
      activeVersionId: row.activeVersionId,
      name: row.name,
      avatarUrl: row.avatarUrl,
      description: row.description,
      persona: row.persona,
      tone: row.tone,
      knowledge: row.knowledge,
      boundaries: row.boundaries,
      examples: row.examples as unknown as SkillDraft["examples"],
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
