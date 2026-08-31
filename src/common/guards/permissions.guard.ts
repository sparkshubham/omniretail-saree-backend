import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RequestUser } from '../../auth/types/jwt-payload';
import { PermissionKey } from '../constants/permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
    const ok = required.every((permission) => user?.permissions.includes(permission));
    if (!ok) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
