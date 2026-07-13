import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  agentDraftSchema,
  agentGoalInputSchema,
  agentKnowledgeInputSchema,
  agentMemoryInputSchema,
  agentPostCommentInputSchema,
  agentPostInputSchema,
  agentRelationshipInputSchema,
  agentUpdateSchema,
  agentGoalUpdateSchema,
  agentTaskInputSchema,
  agentTaskUpdateSchema,
  agentToolCreateSchema,
  agentToolUpdateSchema,
  agentKnowledgeSearchSchema,
  agentReportInputSchema,
  agentModerationSchema
} from "@chaq/shared";
import type { AgentDraft } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { AgentsService } from "./agents.service";

const runSchema = z.object({ conversationId: z.string().min(1).max(128).optional() });
const discoverQuerySchema = z.object({ query: z.string().trim().max(120).optional() });
const activityQuerySchema = z.object({ agentId: z.string().min(1).max(128).optional() });

@Controller("agents")
export class AgentsController {
  constructor(@Inject(AgentsService) private readonly agents: AgentsService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return this.agents.list(userId);
  }

  @Get("activity")
  activity(@CurrentUserId() userId: string, @Query("agentId") agentId?: string) {
    return this.agents.activity(userId, parseBody(activityQuerySchema, { agentId }).agentId);
  }

  @Get("discover")
  discover(@CurrentUserId() userId: string, @Query("query") query?: string) {
    return this.agents.discover(userId, parseBody(discoverQuerySchema, { query }).query);
  }

  @Get("admin/reports")
  adminReports(@CurrentUserId() userId: string) {
    return this.agents.adminReviewQueue(userId);
  }

  @Post("admin/reports/:agentId/resolve")
  resolveReport(@CurrentUserId() userId: string, @Param("agentId") agentId: string, @Body() body: unknown) {
    const input = parseBody(agentModerationSchema, body);
    return this.agents.moderateAgent(userId, agentId, input.action, input.note);
  }

  @Get("contacts")
  contacts(@CurrentUserId() userId: string) {
    return this.agents.contacts(userId);
  }

  @Post(":id/contact")
  addContact(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agents.addContact(userId, id);
  }

  @Post(":id/contact/remove")
  removeContact(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agents.removeContact(userId, id);
  }

  @Post(":id/report")
  report(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.reportAgent(userId, id, parseBody(agentReportInputSchema, body).reason ?? "user_report");
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.agents.create(userId, parseBody(agentDraftSchema, body) as AgentDraft);
  }

  @Post("migrate-skill/:skillId")
  migrateSkill(@CurrentUserId() userId: string, @Param("skillId") skillId: string) {
    return this.agents.migrateSkill(userId, skillId);
  }

  @Get(":id")
  detail(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agents.detail(userId, id);
  }

  @Get(":id/profile")
  profile(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agents.profile(userId, id);
  }

  @Post(":id")
  update(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.update(userId, id, parseBody(agentUpdateSchema, body) as Partial<AgentDraft> & {
      status?: "draft" | "active" | "paused" | "archived";
    });
  }

  @Post(":id/memories")
  addMemory(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.addMemory(userId, id, parseBody(agentMemoryInputSchema, body));
  }

  @Post(":id/posts")
  createPost(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.createPost(userId, id, parseBody(agentPostInputSchema, body));
  }

  @Post(":id/posts/:postId/delete")
  deletePost(@CurrentUserId() userId: string, @Param("id") id: string, @Param("postId") postId: string) {
    return this.agents.deletePost(userId, id, postId);
  }

  @Post("posts/:postId/like")
  togglePostLike(@CurrentUserId() userId: string, @Param("postId") postId: string) {
    return this.agents.togglePostLike(userId, postId);
  }

  @Post("posts/:postId/comments")
  commentOnPost(@CurrentUserId() userId: string, @Param("postId") postId: string, @Body() body: unknown) {
    return this.agents.commentOnPost(userId, postId, parseBody(agentPostCommentInputSchema, body).content);
  }

  @Post(":id/relationships")
  relationship(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.upsertRelationship(userId, id, parseBody(agentRelationshipInputSchema, body));
  }

  @Post(":id/goals")
  addGoal(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.addGoal(userId, id, parseBody(agentGoalInputSchema, body));
  }

  @Post(":id/goals/:goalId")
  updateGoal(@CurrentUserId() userId: string, @Param("id") id: string, @Param("goalId") goalId: string, @Body() body: unknown) {
    return this.agents.updateGoal(userId, id, goalId, parseBody(agentGoalUpdateSchema, body));
  }

  @Post(":id/tasks")
  addTask(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.addTask(userId, id, parseBody(agentTaskInputSchema, body));
  }

  @Post(":id/tasks/:taskId")
  updateTask(@CurrentUserId() userId: string, @Param("id") id: string, @Param("taskId") taskId: string, @Body() body: unknown) {
    return this.agents.updateTask(userId, id, taskId, parseBody(agentTaskUpdateSchema, body));
  }

  @Post(":id/tools/:toolId")
  updateTool(@CurrentUserId() userId: string, @Param("id") id: string, @Param("toolId") toolId: string, @Body() body: unknown) {
    return this.agents.updateTool(userId, id, toolId, parseBody(agentToolUpdateSchema, body));
  }

  @Post(":id/tools")
  addTool(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.addTool(userId, id, parseBody(agentToolCreateSchema, body));
  }

  @Post(":id/knowledge")
  addKnowledge(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.addKnowledge(userId, id, parseBody(agentKnowledgeInputSchema, body));
  }

  @Post(":id/knowledge/:sourceId/reindex")
  reindexKnowledge(@CurrentUserId() userId: string, @Param("id") id: string, @Param("sourceId") sourceId: string) {
    return this.agents.reindexKnowledge(userId, id, sourceId);
  }

  @Post(":id/knowledge/search")
  searchKnowledge(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.agents.searchKnowledge(userId, id, parseBody(agentKnowledgeSearchSchema, body));
  }

  @Post(":id/run")
  run(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    const input = parseBody(runSchema, body ?? {});
    return this.agents.runNow(userId, id, input.conversationId);
  }
}
