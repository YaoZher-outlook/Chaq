import { Body, Controller, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { distillRequestSchema, skillSourceKinds } from "@chaq/shared";
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

@Controller("skills")
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Post("sources")
  logSource(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.logSource(userId, parseBody(sourceLogSchema, body));
  }

  @Post("distill")
  distill(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.skills.distill(userId, parseBody(distillRequestSchema, body));
  }
}
