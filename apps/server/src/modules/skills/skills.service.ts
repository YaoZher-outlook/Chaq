import { randomUUID } from "node:crypto";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DistillationStatus, Prisma, SkillSourceKind, SkillVisibility } from "@prisma/client";
import type { DistillRequest, SkillDraft, SkillSummary, SkillVersionSnapshot } from "@chaq/shared";
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
      select: { id: true, ownerId: true }
    });
    if (!skill) {
      throw new NotFoundException("Skill not found.");
    }
    if (skill.ownerId === userId) {
      throw new ForbiddenException("Cannot report your own skill.");
    }
    const id = randomUUID();
    await this.prisma.$executeRaw`
      insert into "SkillReport" ("id", "reporterId", "skillId", "reason")
      values (${id}, ${userId}, ${skillId}, ${reason})
    `;
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
