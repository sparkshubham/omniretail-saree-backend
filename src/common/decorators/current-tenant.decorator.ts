import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RequestUser } from '../../auth/types/jwt-payload';

export const CurrentTenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  const tenantId = request.user?.tenantId;
  if (!tenantId) {
    throw new ForbiddenException('Tenant context is required for this resource');
  }
  return tenantId;
});
