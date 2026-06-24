import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { skillDraftSchema, skillReportInputSchema, skillSourceKinds } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { MarketplaceService } from "./marketplace.service";

const publishSchema = z.object({
  skill: skillDraftSchema,
  sourceKind: z.enum(skillSourceKinds).default("manual")
});

const reactionSchema = z.object({
  value: z.enum(["up", "down"])
});

const commentSchema = z.object({
  content: z.string().min(1).max(1000)
});

@Controller("marketplace")
export class MarketplaceController {
  constructor(@Inject(MarketplaceService) private readonly marketplace: MarketplaceService) {}

  @Get()
  list(@Query("query") query?: string, @Query("tag") tag?: string) {
    return this.marketplace.list({ query, tag });
  }

  @Post("publish")
  publish(@CurrentUserId() userId: string, @Body() body: unknown) {
    const input = parseBody(publishSchema, body);
    return this.marketplace.publish(userId, { skill: input.skill, sourceKind: input.sourceKind ?? "manual" });
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.marketplace.detail(id);
  }

  @Post(":id/import")
  importSkill(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.marketplace.importSkill(userId, id);
  }

  @Post(":id/report")
  reportSkill(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.marketplace.reportSkill(userId, id, parseBody(skillReportInputSchema, body).reason ?? "user_report");
  }

  @Post(":id/reaction")
  reactToSkill(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.marketplace.reactToSkill(userId, id, parseBody(reactionSchema, body).value);
  }

  @Post(":id/favorite")
  toggleFavorite(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.marketplace.toggleFavorite(userId, id);
  }

  @Get(":id/comments")
  comments(@Param("id") id: string) {
    return this.marketplace.comments(id);
  }

  @Post(":id/comments")
  addComment(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.marketplace.addComment(userId, id, parseBody(commentSchema, body).content);
  }

  @Post("comments/:id/reaction")
  reactToComment(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.marketplace.reactToComment(userId, id, parseBody(reactionSchema, body).value);
  }
}
