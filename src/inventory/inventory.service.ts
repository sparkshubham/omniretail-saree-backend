import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTxnType, Prisma, StockTransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { availableStock, physicalDelta, reservedDelta, assertSufficientStock } from './inventory.math';
import { AdjustmentDto, CreateTransferDto, LedgerQueryDto, OpeningStockDto } from './dto/inventory.dto';
import { PaginationDto, paginationMeta } from '../common/dto/pagination.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser, query: { warehouseId?: string; search?: string; lowStock?: boolean }) {
    const tenantId = requireTenantId(actor);
    const variants = await this.prisma.productVariant.findMany({
      where: {
        tenantId,
        product: { deletedAt: null, tenantId },
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { product: { name: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        product: { select: { id: true, name: true, allowNegativeStock: true } },
        balances: {
          where: query.warehouseId ? { warehouseId: query.warehouseId } : undefined,
          include: { warehouse: true },
        },
      },
      orderBy: { sku: 'asc' },
    });

    const rows = variants.flatMap((variant) => {
      const balances =
        variant.balances.length > 0
          ? variant.balances
          : [
              {
                warehouseId: query.warehouseId ?? '',
                physicalQty: 0,
                reservedQty: 0,
                warehouse: null as { name: string } | null,
              },
            ];
      return balances.map((balance) => {
        const physical = balance.physicalQty;
        const reserved = balance.reservedQty;
        const available = availableStock(physical, reserved);
        return {
          variantId: variant.id,
          productId: variant.productId,
          productName: variant.product.name,
          sku: variant.sku,
          color: variant.color,
          size: variant.size,
          warehouseId: balance.warehouseId,
          warehouseName: balance.warehouse?.name ?? null,
          physicalStock: physical,
          reservedStock: reserved,
          availableStock: available,
          minimumStockLevel: variant.minimumStockLevel,
          isLowStock: available < variant.minimumStockLevel,
        };
      });
    });

    const data = query.lowStock ? rows.filter((row) => row.isLowStock) : rows;
    return { message: 'OK', data };
  }

  async ledger(actor: RequestUser, query: PaginationDto & LedgerQueryDto) {
    const tenantId = requireTenantId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.InventoryTransactionWhereInput = {
      tenantId,
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.transactionType ? { transactionType: query.transactionType } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryTransaction.count({ where }),
      this.prisma.inventoryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          product: { select: { name: true } },
          variant: { select: { sku: true, color: true, size: true } },
          warehouse: { select: { name: true, code: true } },
        },
      }),
    ]);
    return { message: 'OK', data: rows, meta: paginationMeta(total, page, limit) };
  }

  async opening(actor: RequestUser, dto: OpeningStockDto, ip?: string) {
    return this.postMovement(actor, {
      variantId: dto.variantId,
      warehouseId: dto.warehouseId,
      type: InventoryTxnType.OPENING_STOCK,
      quantity: dto.quantity,
      notes: dto.notes,
      ip,
    });
  }

  async adjustment(actor: RequestUser, dto: AdjustmentDto, ip?: string) {
    if (dto.quantity === 0) {
      throw new BadRequestException('Adjustment quantity cannot be zero');
    }
    return this.postMovement(actor, {
      variantId: dto.variantId,
      warehouseId: dto.warehouseId,
      type: InventoryTxnType.ADJUSTMENT,
      quantity: dto.quantity,
      notes: dto.notes,
      ip,
    });
  }

  async transfer(actor: RequestUser, dto: CreateTransferDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must differ');
    }
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: this.prisma.tenantWhere(tenantId, { id: dto.fromWarehouseId }) }),
      this.prisma.warehouse.findFirst({ where: this.prisma.tenantWhere(tenantId, { id: dto.toWarehouseId }) }),
    ]);
    if (!from || !to) {
      throw new NotFoundException('Warehouse not found');
    }

    const transferNumber = `TR-${Date.now()}`;
    const transfer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          tenantId,
          transferNumber,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          status: StockTransferStatus.RECEIVED,
          notes: dto.notes,
          createdById: actor.id,
          items: {
            create: await Promise.all(
              dto.items.map(async (item) => {
                const variant = await this.requireVariant(tx, tenantId, item.variantId);
                return {
                  tenantId,
                  productId: variant.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                };
              }),
            ),
          },
        },
        include: { items: true },
      });

      for (const item of created.items) {
        await this.applyMovement(tx, {
          tenantId,
          variantId: item.variantId,
          warehouseId: dto.fromWarehouseId,
          type: InventoryTxnType.TRANSFER_OUT,
          quantity: item.quantity,
          referenceType: 'stock_transfer',
          referenceId: created.id,
          createdById: actor.id,
          notes: dto.notes,
        });
        await this.applyMovement(tx, {
          tenantId,
          variantId: item.variantId,
          warehouseId: dto.toWarehouseId,
          type: InventoryTxnType.TRANSFER_IN,
          quantity: item.quantity,
          referenceType: 'stock_transfer',
          referenceId: created.id,
          createdById: actor.id,
          notes: dto.notes,
        });
      }
      return created;
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'inventory.transfer',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      newData: { transferNumber, from: from.code, to: to.code } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return { message: 'Stock transferred', data: transfer };
  }

  async lowStockCount(tenantId: string) {
    const variants = await this.prisma.productVariant.findMany({
      where: { tenantId, product: { deletedAt: null } },
      include: { balances: true },
    });
    return variants.filter((variant) => {
      const physical = variant.balances.reduce((s, b) => s + b.physicalQty, 0);
      const reserved = variant.balances.reduce((s, b) => s + b.reservedQty, 0);
      return availableStock(physical, reserved) < variant.minimumStockLevel;
    }).length;
  }

  private async postMovement(
    actor: RequestUser,
    input: {
      variantId: string;
      warehouseId: string;
      type: InventoryTxnType;
      quantity: number;
      notes?: string;
      ip?: string;
    },
  ) {
    const tenantId = requireTenantId(actor);
    const txn = await this.prisma.$transaction(async (tx) =>
      this.applyMovement(tx, {
        tenantId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        type: input.type,
        quantity: input.quantity,
        notes: input.notes,
        createdById: actor.id,
      }),
    );
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: `inventory.${input.type.toLowerCase()}`,
      entityType: 'InventoryTransaction',
      entityId: txn.id,
      newData: { quantity: input.quantity, type: input.type } as Prisma.InputJsonObject,
      ipAddress: input.ip,
    });
    return { message: 'Inventory updated', data: txn };
  }

  async applyMovement(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      variantId: string;
      warehouseId: string;
      type: InventoryTxnType;
      quantity: number;
      notes?: string;
      referenceType?: string;
      referenceId?: string;
      createdById?: string;
    },
  ) {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, tenantId: input.tenantId },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    const variant = await this.requireVariant(tx, input.tenantId, input.variantId);

    try {
      await tx.stockBalance.create({
        data: {
          tenantId: input.tenantId,
          productId: variant.productId,
          variantId: input.variantId,
          warehouseId: input.warehouseId,
        },
      });
    } catch {
      /* unique: row already exists */
    }

    const locked = await tx.$queryRaw<Array<{ id: string; physicalQty: number; reservedQty: number }>>`
      SELECT id, "physicalQty", "reservedQty"
      FROM "StockBalance"
      WHERE "tenantId" = ${input.tenantId}
        AND "variantId" = ${input.variantId}
        AND "warehouseId" = ${input.warehouseId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) {
      throw new BadRequestException('Could not lock inventory balance');
    }

    const pDelta = physicalDelta(input.type, input.quantity);
    const rDelta = reservedDelta(input.type, input.quantity);
    try {
      assertSufficientStock({
        physicalQty: row.physicalQty,
        reservedQty: row.reservedQty,
        physicalDelta: pDelta,
        reservedDelta: rDelta,
        allowNegative: variant.product.allowNegativeStock,
      });
    } catch {
      throw new BadRequestException('Insufficient available stock for this movement');
    }

    await tx.stockBalance.update({
      where: { id: row.id },
      data: {
        physicalQty: { increment: pDelta },
        reservedQty: { increment: rDelta },
      },
    });

    return tx.inventoryTransaction.create({
      data: {
        tenantId: input.tenantId,
        productId: variant.productId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        transactionType: input.type,
        quantity: input.quantity,
        physicalDelta: pDelta,
        reservedDelta: rDelta,
        notes: input.notes,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdById: input.createdById,
      },
    });
  }

  private async requireVariant(tx: Prisma.TransactionClient, tenantId: string, variantId: string) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, tenantId, product: { deletedAt: null } },
      include: { product: { select: { allowNegativeStock: true } } },
    });
    if (!variant) {
      throw new NotFoundException('Variant not found');
    }
    return variant;
  }
}
