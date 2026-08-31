import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { SYSTEM_ROLES } from '../constants/roles';
import { RequestUser } from '../../auth/types/jwt-payload';

function ctx(user: Partial<RequestUser> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows COMPANY_ADMIN for required company role', () => {
    const reflector = { getAllAndOverride: () => [SYSTEM_ROLES.COMPANY_ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const user: Partial<RequestUser> = { roles: [SYSTEM_ROLES.COMPANY_ADMIN], tenantId: 't1' };
    expect(guard.canActivate(ctx(user))).toBe(true);
  });

  it('blocks SALES_STAFF from company-admin-only routes', () => {
    const reflector = { getAllAndOverride: () => [SYSTEM_ROLES.COMPANY_ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const user: Partial<RequestUser> = { roles: [SYSTEM_ROLES.SALES_STAFF], tenantId: 't1' };
    expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
  });
});
