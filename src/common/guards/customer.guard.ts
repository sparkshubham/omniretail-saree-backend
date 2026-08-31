import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CUSTOMER_ACCOUNT_KEY } from '../decorators/customer-account.decorator';
import { RequestUser } from '../../auth/types/jwt-payload';

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(CUSTOMER_ACCOUNT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user?.isCustomer || !user.customerId || !user.tenantId) {
      throw new ForbiddenException('Sign in with a customer account to continue');
    }
    return true;
  }
}
