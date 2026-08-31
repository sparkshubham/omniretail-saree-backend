import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AssignPlanDto, CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { PaginationDto, paginationMeta } from '../common/dto/pagination.dto';
import { FEATURE_KEYS } from '../common/constants/features';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { FeaturesService } from '../features/features.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationDto & { search?: string; status?: TenantStatus }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: { select: { users: true } },
        },
      }),
    ]);

    return {
      message: 'OK',
      data: rows,
      meta: paginationMeta(total, page, limit),
    };
  }

  async get(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: true } },
        features: true,
        _count: { select: { users: true } },
      },
    });
    if (!tenant) {
      throw new NotFoundException('Company not found');
    }
    return { message: 'OK', data: tenant };
  }

  async create(dto: CreateTenantDto, actorId: string, ip?: string) {
    const slug = dto.slug.toLowerCase();
    const exists = await this.prisma.tenant.findUnique({ where: { slug } });
    if (exists) {
      throw new ConflictException('Slug already in use');
    }

    const plan = dto.planId
      ? await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } })
      : await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'basic' } });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    const adminRole = await this.prisma.role.findFirst({
      where: { slug: SYSTEM_ROLES.COMPANY_ADMIN, isSystem: true },
    });
    if (!adminRole) {
      throw new NotFoundException('COMPANY_ADMIN role is not seeded');
    }

    const trialStart = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: dto.name,
          businessName: dto.businessName,
          slug,
          email: dto.email.toLowerCase(),
          mobile: dto.mobile,
          address: dto.address,
          gstNumber: dto.gstNumber,
          status: TenantStatus.TRIAL,
          trialStartDate: trialStart,
          trialEndDate: trialEnd,
        },
      });

      await tx.tenantSubscription.create({
        data: {
          tenantId: created.id,
          planId: plan.id,
          status: 'TRIAL',
          startDate: trialStart,
          endDate: trialEnd,
        },
      });

      await tx.tenantFeature.createMany({
        data: FEATURE_KEYS.map((key) => ({
          tenantId: created.id,
          featureKey: key,
          isEnabled: plan.featureKeys.includes(key),
        })),
      });

      if (dto.adminEmail && dto.adminPassword) {
        const user = await tx.user.create({
          data: {
            tenantId: created.id,
            email: dto.adminEmail.toLowerCase(),
            passwordHash: await bcrypt.hash(dto.adminPassword, 12),
            firstName: dto.adminFirstName ?? 'Company',
            lastName: dto.adminLastName ?? 'Admin',
            mobile: dto.mobile,
            status: UserStatus.ACTIVE,
          },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
      }

      await tx.warehouse.create({
        data: {
          tenantId: created.id,
          name: 'Main Warehouse',
          code: 'MAIN',
          isDefault: true,
        },
      });

      return created;
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: actorId,
      action: 'tenant.create',
      entityType: 'Tenant',
      entityId: tenant.id,
      newData: { slug, name: dto.name },
      ipAddress: ip,
    });

    return this.get(tenant.id);
  }

  async update(id: string, dto: UpdateTenantDto, actorId: string, ip?: string) {
    const existing = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Company not found');
    }
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        name: dto.name,
        businessName: dto.businessName,
        email: dto.email?.toLowerCase(),
        mobile: dto.mobile,
        address: dto.address,
        gstNumber: dto.gstNumber,
        logo: dto.logo,
        status: dto.status,
      },
    });
    await this.audit.log({
      tenantId: id,
      userId: actorId,
      action: 'tenant.update',
      entityType: 'Tenant',
      entityId: id,
      oldData: { status: existing.status, name: existing.name },
      newData: { status: updated.status, name: updated.name },
      ipAddress: ip,
    });
    return this.get(id);
  }

  async setStatus(id: string, status: TenantStatus, actorId: string, ip?: string) {
    return this.update(id, { status }, actorId, ip);
  }

  async remove(id: string, actorId: string, ip?: string) {
    const existing = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Company not found');
    }
    await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), status: TenantStatus.INACTIVE },
    });
    await this.audit.log({
      tenantId: id,
      userId: actorId,
      action: 'tenant.delete',
      entityType: 'Tenant',
      entityId: id,
      ipAddress: ip,
    });
    return { message: 'Company deleted', data: null };
  }

  async assignPlan(id: string, dto: AssignPlanDto, actorId: string, ip?: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!tenant) {
      throw new NotFoundException('Company not found');
    }
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.prisma.tenantSubscription.create({
      data: {
        tenantId: id,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: new Date(),
      },
    });
    await this.features.syncFromPlan(id, plan.featureKeys);
    await this.audit.log({
      tenantId: id,
      userId: actorId,
      action: 'tenant.assign_plan',
      entityType: 'TenantSubscription',
      entityId: id,
      newData: { plan: plan.slug },
      ipAddress: ip,
    });
    return this.get(id);
  }
}
