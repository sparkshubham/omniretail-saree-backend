import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestUser } from '../../auth/types/jwt-payload';
import { SYSTEM_ROLES } from '../constants/roles';

/**
 * Ensures tenant users always operate inside their JWT tenant.
 * Super admins may access platform routes without a tenant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    if (user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
      return true;
    }
    if (!user.tenantId) {
      throw new ForbiddenException('Tenant context missing from session');
    }
    return true;
  }
}
