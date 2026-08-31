import { Injectable } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async stats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCompanies,
      activeCompanies,
      inactiveCompanies,
      suspendedCompanies,
      trialCompanies,
      totalUsers,
      activeSubscriptions,
      plans,
      totalProducts,
      totalOrders,
      paidSales,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: { deletedAt: null } }),
      this.prisma.tenant.count({ where: { deletedAt: null, status: TenantStatus.ACTIVE } }),
      this.prisma.tenant.count({ where: { deletedAt: null, status: TenantStatus.INACTIVE } }),
      this.prisma.tenant.count({ where: { deletedAt: null, status: TenantStatus.SUSPENDED } }),
      this.prisma.tenant.count({ where: { deletedAt: null, status: TenantStatus.TRIAL } }),
      this.prisma.user.count({ where: { deletedAt: null, tenantId: { not: null } } }),
      this.prisma.tenantSubscription.count({ where: { status: { in: ['ACTIVE', 'TRIAL'] } } }),
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'PAID', status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true },
      }),
    ]);

    const currentSubs = await this.prisma.tenantSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      include: { plan: true },
      distinct: ['tenantId'],
      orderBy: { createdAt: 'desc' },
    });

    const mrr = currentSubs.reduce((sum, sub) => sum + Number(sub.plan.priceMonthly), 0);

    const recentTenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null, createdAt: { gte: monthStart } },
      select: { id: true },
    });

    return {
      message: 'OK',
      data: {
        totalCompanies,
        activeCompanies,
        inactiveCompanies,
        suspendedCompanies,
        trialCompanies,
        totalUsers,
        totalProducts,
        totalOrders,
        totalPlatformSales: Number(paidSales._sum.totalAmount ?? 0),
        monthlyRecurringRevenue: mrr,
        activeSubscriptions,
        newCompaniesThisMonth: recentTenants.length,
        plans: plans.length,
      },
    };
  }
}
