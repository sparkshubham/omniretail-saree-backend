import { ForbiddenException } from '@nestjs/common';
import { RequestUser } from '../../auth/types/jwt-payload';

export function requireTenantId(actor: RequestUser): string {
  if (!actor.tenantId) {
    throw new ForbiddenException('Tenant context is required');
  }
  return actor.tenantId;
}
