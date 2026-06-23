import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { distillRequestSchema, skillDraftSchema, skillSourceKinds } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { SkillsService } from "./skills.service";

const sourceLogSchema = z.object({
  skillId: z.string().optional(),
  kind: z.enum(skillSourceKinds),
  fileName: z.string().min(1).max(260),
  messageCount: z.number().int().nonnegative(),
  rawPreview: z.unknown().optional()
});

const createSkillSchema = z.object({
  skill: skillDraftSchema,
  sourceKind: z.enum(skillSourceKinds).default("manual")
});

const updateSkillSchema = createSkillSchema.partial().extend({
  skill: skillDraftSchema
});

const reportSkillSchema = z.object({
  reason: z.string().min(1).max(500).default("user_report")
});

@Controller("skills")
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return this.skills.listSkills(userId);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() body: unknown) {
    const input = parseBody(createSkillSchema, body);
    return this.skills.createSkill(userId, input.skill, input.sourceKind ?? "manual");
  }

  @Get(":id")
  detail(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.skills.getSkill(userId, id);
  }

  @Post(":id")
  update(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    const input = parseBody(updateSkillSchema, body);
    return this.skills.updateSkill(userId, id, input.skill, input.sourceKind ?? "manual");
  }

  @Get(":id/versions")
  versions(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.skills.listVersions(userId, id);
  }

  @Post(":id/delete")
  delete(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.skills.deleteSkill(userId, id);
  }

  @Post("sources")
  logSource(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.logSource(userId, parseBody(sourceLogSchema, body));
  }

  @Post("distill")
  distill(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.distill(userId, parseBody(distillRequestSchema, body));
  }

  @Post(":id/report")
  report(@CurrentUserId() userId: string, @Body() body: unknown, @Param("id") id: string) {
    return this.skills.reportSkill(userId, id, parseBody(reportSkillSchema, body).reason ?? "user_report");
  }
}
