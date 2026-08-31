import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { TenantStatus } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { AssignPlanDto, CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { IsEnum, IsOptional, IsString } from 'class-validator';

class TenantQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}

@Controller('tenants')
@Roles(SYSTEM_ROLES.SUPER_ADMIN)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENANTS_READ)
  list(@Query() query: TenantQueryDto) {
    return this.tenants.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TENANTS_READ)
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  create(@Body() dto: CreateTenantDto, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.tenants.create(dto, user.id, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.tenants.update(id, dto, user.id, req.ip);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.tenants.setStatus(id, TenantStatus.ACTIVE, user.id, req.ip);
  }

  @Post(':id/suspend')
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  suspend(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.tenants.setStatus(id, TenantStatus.SUSPENDED, user.id, req.ip);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.tenants.remove(id, user.id, req.ip);
  }

  @Post(':id/subscription')
  @RequirePermissions(PERMISSIONS.TENANTS_WRITE)
  assignPlan(
    @Param('id') id: string,
    @Body() dto: AssignPlanDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.tenants.assignPlan(id, dto, user.id, req.ip);
  }
}
