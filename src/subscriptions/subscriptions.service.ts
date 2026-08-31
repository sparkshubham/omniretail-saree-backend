import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listPlans(includeInactive = false) {
    const data = await this.prisma.subscriptionPlan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { message: 'OK', data };
  }

  async createPlan(dto: CreatePlanDto, actorId: string) {
    const exists = await this.prisma.subscriptionPlan.findUnique({ where: { slug: dto.slug } });
    if (exists) {
      throw new ConflictException('Plan slug already exists');
    }
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        slug: dto.slug.toLowerCase(),
        description: dto.description,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        featureKeys: dto.featureKeys ?? [],
        isCustom: dto.isCustom ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'plan.create',
      entityType: 'SubscriptionPlan',
      entityId: plan.id,
      newData: { slug: plan.slug },
    });
    return { message: 'Plan created', data: plan };
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorId: string) {
    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found');
    }
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        priceMonthly: dto.priceMonthly as Prisma.Decimal | undefined,
        priceYearly: dto.priceYearly as Prisma.Decimal | undefined,
        featureKeys: dto.featureKeys,
        isActive: dto.isActive,
        isCustom: dto.isCustom,
        sortOrder: dto.sortOrder,
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'plan.update',
      entityType: 'SubscriptionPlan',
      entityId: id,
      oldData: { name: existing.name, priceMonthly: existing.priceMonthly.toString() },
      newData: { name: plan.name, priceMonthly: plan.priceMonthly.toString() },
    });
    return { message: 'Plan updated', data: plan };
  }

  async stats() {
    const [active, trial, cancelled] = await Promise.all([
      this.prisma.tenantSubscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenantSubscription.count({ where: { status: 'TRIAL' } }),
      this.prisma.tenantSubscription.count({ where: { status: 'CANCELLED' } }),
    ]);
    return { active, trial, cancelled };
  }
}
