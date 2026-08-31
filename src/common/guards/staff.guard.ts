import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_CUSTOMER_KEY } from '../decorators/allow-customer.decorator';
import { RequestUser } from '../../auth/types/jwt-payload';

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const allowCustomer = this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowCustomer) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (user?.isCustomer) {
      throw new ForbiddenException('Staff access required');
    }
    return true;
  }
}
