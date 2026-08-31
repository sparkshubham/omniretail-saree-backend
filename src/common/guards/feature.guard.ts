import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/require-feature.decorator';
import { RequestUser } from '../../auth/types/jwt-payload';
import { FeaturesService } from '../../features/features.service';
import { FeatureKey } from '../constants/features';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
    if (user?.isSuperAdmin) {
      return true;
    }
    if (!user?.tenantId) {
      throw new ForbiddenException('Tenant context is required');
    }
    const enabled = await this.features.isEnabled(user.tenantId, feature);
    if (!enabled) {
      throw new ForbiddenException(`${feature.replace('ENABLE_', '').replaceAll('_', ' ')} is not enabled for your subscription.`);
    }
    return true;
  }
}
