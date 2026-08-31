import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { AuditService } from '../audit/audit.service';

class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  gstNumber?: string;
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  async getCompany(@CurrentTenantId() tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
        features: true,
      },
    });
    return { message: 'OK', data: tenant };
  }

  @Patch('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  async updateCompany(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCompanyDto,
  ) {
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
    });
    await this.audit.log({
      tenantId,
      userId: user.id,
      action: 'settings.company.update',
      entityType: 'Tenant',
      entityId: tenantId,
      newData: { ...dto } as Prisma.InputJsonObject,
    });
    return { message: 'Company settings updated', data: updated };
  }
}
