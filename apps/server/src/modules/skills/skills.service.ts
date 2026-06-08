import { Inject, Injectable } from "@nestjs/common";
import { SkillSourceKind } from "@prisma/client";
import type { DistillRequest } from "@chaq/shared";
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

  private toSourceKind(kind: string): SkillSourceKind {
    return SkillSourceKind[kind.toUpperCase() as keyof typeof SkillSourceKind] ?? SkillSourceKind.MANUAL;
  }
}
