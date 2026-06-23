import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { cloudChatRequestSchema, privateProviderConfigSchema, providerConfigSchema } from "@chaq/shared";
import { CurrentUserId } from "../../common/current-user.decorator";
import { parseBody } from "../../common/http-errors";
import { ModelsService } from "./models.service";

const providerUpsertSchema = providerConfigSchema.extend({
  id: z.string().optional(),
  apiKey: z.string().max(5000).optional().default("")
});

const providerStatusSchema = z.object({
  enabled: z.boolean()
});

@Controller("models")
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly models: ModelsService) {}

  @Get("providers")
  publicProviders() {
    return this.models.publicProviders();
  }

  @Get("available")
  availableProviders(@CurrentUserId() userId: string) {
    return this.models.availableProviders(userId);
  }

  @Get("private/providers")
  privateProviders(@CurrentUserId() userId: string) {
    return this.models.privateProviders(userId);
  }

  @Post("private/providers")
  upsertPrivateProvider(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.models.upsertPrivateProvider(userId, parseBody(privateProviderConfigSchema, body));
  }

  @Post("private/providers/:id/delete")
  deletePrivateProvider(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.models.deletePrivateProvider(userId, id);
  }

  @Post("private/test")
  testPrivateProvider(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.models.testPrivateProvider(userId, parseBody(privateProviderConfigSchema, body));
  }

  @Get("admin/providers")
  adminProviders(@CurrentUserId() userId: string) {
    return this.models.adminProviders(userId);
  }

  @Post("admin/providers")
  upsertProvider(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.models.upsertProvider(userId, parseBody(providerUpsertSchema, body));
  }

  @Post("admin/providers/:id/status")
  updateProviderStatus(@CurrentUserId() userId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.models.updateProviderStatus(userId, id, parseBody(providerStatusSchema, body).enabled);
  }

  @Post("cloud/chat")
  cloudChat(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.models.cloudChat(userId, parseBody(cloudChatRequestSchema, body));
  }
}
