import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { availableStock } from '../inventory/inventory.math';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const paid = await this.prisma.order.findMany({
      where: {
        tenantId,
        paymentStatus: PaymentStatus.PAID,
        status: { notIn: [OrderStatus.CANCELLED] },
      },
      select: { totalAmount: true, taxAmount: true, source: true, createdAt: true, status: true },
    });
    const byChannel: Record<string, number> = {
      WHATSAPP: 0,
      AMAZON: 0,
      FLIPKART: 0,
      WEBSITE: 0,
      MANUAL: 0,
    };
    const byDay = new Map<string, number>();
    let gmv = 0;
    let tax = 0;
    for (const row of paid) {
      const amount = Number(row.totalAmount);
      gmv += amount;
      tax += Number(row.taxAmount);
      byChannel[row.source] = (byChannel[row.source] ?? 0) + amount;
      const day = row.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + amount);
    }
    return {
      message: 'OK',
      data: {
        gmv,
        tax,
        orderCount: paid.length,
        byChannel,
        byDay: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-14)
          .map(([date, amount]) => ({ date, amount })),
      },
    };
  }

  async inventory(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const variants = await this.prisma.productVariant.findMany({
      where: { tenantId, product: { deletedAt: null } },
      include: { product: { select: { name: true } }, balances: true },
    });
    const rows = variants.map((variant) => {
      const physical = variant.balances.reduce((sum, row) => sum + row.physicalQty, 0);
      const reserved = variant.balances.reduce((sum, row) => sum + row.reservedQty, 0);
      const available = availableStock(physical, reserved);
      const value = available * Number(variant.purchasePrice);
      return {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        physical,
        reserved,
        available,
        stockValue: value,
        isLowStock: available < variant.minimumStockLevel,
      };
    });
    return {
      message: 'OK',
      data: {
        skuCount: rows.length,
        lowStockCount: rows.filter((row) => row.isLowStock).length,
        stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
        lowStock: rows.filter((row) => row.isLowStock).slice(0, 20),
      },
    };
  }

  async products(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const items = await this.prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        tenantId,
        order: { paymentStatus: PaymentStatus.PAID, status: { not: OrderStatus.CANCELLED } },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    });
    return {
      message: 'OK',
      data: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item._sum.quantity ?? 0,
        sales: Number(item._sum.total ?? 0),
      })),
    };
  }

  async customers(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { totalPurchase: 'desc' },
      take: 10,
      select: { id: true, name: true, mobile: true, totalOrders: true, totalPurchase: true, lastOrderDate: true },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({ ...row, totalPurchase: Number(row.totalPurchase) })),
    };
  }

  async gst(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const paid = await this.prisma.order.findMany({
      where: { tenantId, paymentStatus: PaymentStatus.PAID, status: { not: OrderStatus.CANCELLED } },
      select: { taxAmount: true, totalAmount: true, createdAt: true },
    });
    return {
      message: 'OK',
      data: {
        taxableSales: paid.reduce((sum, row) => sum + Number(row.totalAmount) - Number(row.taxAmount), 0),
        gstCollected: paid.reduce((sum, row) => sum + Number(row.taxAmount), 0),
        invoiceCount: paid.length,
      },
    };
  }
}
