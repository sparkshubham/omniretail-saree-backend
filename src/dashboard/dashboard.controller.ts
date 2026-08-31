import { Controller, Get } from '@nestjs/common';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  async tenantDashboard(@CurrentUser() user: RequestUser, @CurrentTenantId() tenantId: string) {
    const [staffCount, features, productCount, customerCount, lowStock, orderStats] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.tenantFeature.findMany({ where: { tenantId, isEnabled: true } }),
      this.prisma.product.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      this.inventory.lowStockCount(tenantId),
      this.orders.stats(tenantId),
    ]);

    return {
      message: 'OK',
      data: {
        company: user.tenantId,
        todaySales: orderStats.todaySales,
        todayOrders: orderStats.todayOrders,
        pendingOrders: orderStats.pendingOrders,
        lowStock,
        staffCount,
        productCount,
        customerCount,
        enabledFeatures: features.map((f) => f.featureKey),
        salesByChannel: orderStats.salesByChannel,
      },
    };
  }
}
