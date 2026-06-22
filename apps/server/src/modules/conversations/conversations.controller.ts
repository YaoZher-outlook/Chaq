import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { conversationMessageInputSchema } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { ConversationsService } from "./conversations.service";

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
    return this.conversations.messages(userId, id, before);
  }

  @Post(":id/messages")
  send(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    const input = parseBody(conversationMessageInputSchema, body);
    return this.conversations.sendUserMessage(userId, id, input.content, input.replyToId);
  }

  @Post(":id/read")
  read(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.conversations.markRead(userId, id);
  }
}
