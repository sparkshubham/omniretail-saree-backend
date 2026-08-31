import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsBoolean, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FeaturesService } from './features.service';
import { FEATURE_KEYS } from '../common/constants/features';
import { Roles } from '../common/decorators/roles.decorator';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';

class FeatureFlagDto {
  @IsIn([...FEATURE_KEYS])
  featureKey!: string;

  @IsBoolean()
  isEnabled!: boolean;
}

class UpdateFeaturesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagDto)
  features!: FeatureFlagDto[];
}

@Controller()
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get('tenants/:id/features')
  @Roles(SYSTEM_ROLES.SUPER_ADMIN)
  @RequirePermissions(PERMISSIONS.TENANTS_READ)
  async list(@Param('id') id: string) {
    const data = await this.features.listForTenant(id);
    return { message: 'OK', data };
  }

  @Patch('tenants/:id/features')
  @Roles(SYSTEM_ROLES.SUPER_ADMIN)
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  async update(@Param('id') id: string, @Body() dto: UpdateFeaturesDto) {
    const data = await this.features.setForTenant(id, dto.features);
    return { message: 'Features updated', data };
  }

  @Get('features/me')
  async mine(@CurrentUser() user: RequestUser) {
    if (!user.tenantId) {
      return { message: 'OK', data: FEATURE_KEYS.map((featureKey) => ({ featureKey, isEnabled: true })) };
    }
    const data = await this.features.listForTenant(user.tenantId);
    return { message: 'OK', data };
  }
}
