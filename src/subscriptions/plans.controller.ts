import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { Public } from '../common/decorators/public.decorator';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

class PlanQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

@Controller('plans')
export class PlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get()
  list(@Query() query: PlanQueryDto) {
    return this.subscriptions.listPlans(query.includeInactive === true);
  }

  @Post()
  @Roles(SYSTEM_ROLES.SUPER_ADMIN)
  @RequirePermissions(PERMISSIONS.PLANS_WRITE)
  create(@Body() dto: CreatePlanDto, @CurrentUser() user: RequestUser) {
    return this.subscriptions.createPlan(dto, user.id);
  }

  @Patch(':id')
  @Roles(SYSTEM_ROLES.SUPER_ADMIN)
  @RequirePermissions(PERMISSIONS.PLANS_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto, @CurrentUser() user: RequestUser) {
    return this.subscriptions.updatePlan(id, dto, user.id);
  }
}
