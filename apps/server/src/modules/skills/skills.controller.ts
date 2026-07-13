import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { distillRequestSchema, skillDraftSchema, skillModerationSchema, skillReportInputSchema, skillSourceKinds } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { SkillsService } from "./skills.service";

const sourceLogSchema = z.object({
  skillId: z.string().min(1).max(128).optional(),
  kind: z.enum(skillSourceKinds),
  fileName: z.string().min(1).max(260),
  messageCount: z.number().int().nonnegative().max(1_000_000),
  rawPreview: z.unknown().refine(
    (value) => serializedSize(value) <= 200_000,
    "rawPreview must be no larger than 200 KB"
  ).optional()
});

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const createSkillSchema = z.object({
  skill: skillDraftSchema,
  sourceKind: z.enum(skillSourceKinds).default("manual")
});

const updateSkillSchema = createSkillSchema.partial().extend({
  skill: skillDraftSchema
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

  // Static one-segment routes must be registered before the dynamic :id POST
  // route below, otherwise Express can interpret "sources" as a skill id.
  @Post("sources")
  logSource(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.logSource(userId, parseBody(sourceLogSchema, body));
  }

  @Post("distill")
  distill(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.distill(userId, parseBody(distillRequestSchema, body));
  }

  @Get("admin/reports")
  adminReports(@CurrentUserId() userId: string) {
    return this.skills.adminReviewQueue(userId);
  }

  @Post("admin/reports/:skillId/resolve")
  moderate(@CurrentUserId() userId: string, @Param("skillId") skillId: string, @Body() body: unknown) {
    const input = parseBody(skillModerationSchema, body);
    return this.skills.moderateSkill(userId, skillId, input.action, input.note ?? "");
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

  @Post(":id/report")
  report(@CurrentUserId() userId: string, @Body() body: unknown, @Param("id") id: string) {
    return this.skills.reportSkill(userId, id, parseBody(skillReportInputSchema, body).reason ?? "user_report");
  }
}
