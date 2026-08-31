import { TenantGuard } from './tenant.guard';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { SYSTEM_ROLES } from '../constants/roles';

describe('TenantGuard', () => {
  const guard = new TenantGuard();

  function ctx(user: unknown) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  it('allows super admin without tenantId', () => {
    expect(
      guard.canActivate(
        ctx({ roles: [SYSTEM_ROLES.SUPER_ADMIN], tenantId: null, isSuperAdmin: true }),
      ),
    ).toBe(true);
  });

  it('rejects tenant staff without tenantId in JWT', () => {
    expect(() =>
      guard.canActivate(ctx({ roles: [SYSTEM_ROLES.SALES_STAFF], tenantId: null })),
    ).toThrow(ForbiddenException);
  });

  it('allows tenant staff with tenantId from JWT', () => {
    expect(
      guard.canActivate(ctx({ roles: [SYSTEM_ROLES.SALES_STAFF], tenantId: 'ganpati-id' })),
    ).toBe(true);
  });
});
