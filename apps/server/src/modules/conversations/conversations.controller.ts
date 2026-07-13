import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { conversationMessageInputSchema } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { ConversationsService } from "./conversations.service";

const sendMessageSchema = conversationMessageInputSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(200).optional()
});
const messageQuerySchema = z.object({ before: z.string().trim().max(64).optional() });

@Controller("conversations")
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUserId() userId: string) {
    return this.conversations.list(userId);
  }

  @Post("with-agent/:agentId")
  withAgent(@CurrentUserId() userId: string, @Param("agentId") agentId: string) {
    return this.conversations.withAgent(userId, agentId);
  }

  @Get(":id/messages")
  messages(@CurrentUserId() userId: string, @Param("id") id: string, @Query("before") before?: string) {
    return this.conversations.messages(userId, id, parseBody(messageQuerySchema, { before }).before);
  }

  @Post(":id/messages")
  send(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    const input = parseBody(sendMessageSchema, body);
    return this.conversations.sendUserMessage(userId, id, input.content, input.replyToId, input.idempotencyKey);
  }

  @Post(":id/read")
  read(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.conversations.markRead(userId, id);
  }
}
