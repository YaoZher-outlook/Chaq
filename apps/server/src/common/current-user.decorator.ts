import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";

export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<{ currentUser?: { id: string } }>();
  if (!request.currentUser?.id) {
    throw new UnauthorizedException("请先登录。");
  }
  return request.currentUser.id;
});
