import { Controller, Get } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { Roles } from '../common/decorators/roles.decorator';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller('platform')
@Roles(SYSTEM_ROLES.SUPER_ADMIN)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('stats')
  @RequirePermissions(PERMISSIONS.PLATFORM_READ)
  stats() {
    return this.platform.stats();
  }
}
