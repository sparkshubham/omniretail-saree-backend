import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const data = await this.prisma.warehouse.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { message: 'OK', data };
  }

  async create(actor: RequestUser, dto: CreateWarehouseDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const count = await this.prisma.warehouse.count({ where: { tenantId } });
    if (count >= 1) {
      const multi = await this.features.isEnabled(tenantId, 'ENABLE_MULTI_WAREHOUSE');
      if (!multi) {
        throw new ForbiddenException('Multiple warehouses are not enabled for your subscription.');
      }
    }

    const code = dto.code.toUpperCase().trim();
    const exists = await this.prisma.warehouse.findFirst({
      where: this.prisma.tenantWhere(tenantId, { code }),
    });
    if (exists) {
      throw new ConflictException('Warehouse code already exists');
    }

    const warehouse = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault || count === 0) {
        await tx.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } });
      }
      return tx.warehouse.create({
        data: {
          tenantId,
          name: dto.name,
          code,
          address: dto.address,
          isDefault: dto.isDefault ?? count === 0,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'warehouse.create',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      newData: { name: warehouse.name, code } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return { message: 'Warehouse created', data: warehouse };
  }

  async update(actor: RequestUser, id: string, dto: UpdateWarehouseDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.warehouse.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
    });
    if (!existing) {
      throw new NotFoundException('Warehouse not found');
    }

    const warehouse = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } });
      }
      return tx.warehouse.update({
        where: { id },
        data: {
          name: dto.name,
          address: dto.address,
          status: dto.status,
          isDefault: dto.isDefault,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'warehouse.update',
      entityType: 'Warehouse',
      entityId: id,
      oldData: { name: existing.name, status: existing.status } as Prisma.InputJsonObject,
      newData: { name: warehouse.name, status: warehouse.status } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return { message: 'Warehouse updated', data: warehouse };
  }

  async defaultWarehouse(tenantId: string) {
    const row =
      (await this.prisma.warehouse.findFirst({
        where: { tenantId, isDefault: true, status: RecordStatus.ACTIVE },
      })) ??
      (await this.prisma.warehouse.findFirst({
        where: { tenantId, status: RecordStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
      }));
    if (!row) {
      throw new NotFoundException('No warehouse configured');
    }
    return row;
  }
}
