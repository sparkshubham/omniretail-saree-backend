import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../../auth/types/jwt-payload';
import { SystemRole } from '../constants/roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
    if (!user?.roles.some((role) => required.includes(role as SystemRole))) {
      throw new ForbiddenException('You do not have the required role');
    }
    return true;
  }
}
