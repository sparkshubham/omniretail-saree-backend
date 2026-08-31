import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, Prisma, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { paginationMeta } from '../common/dto/pagination.dto';
import { roundMoney } from '../common/utils/money';
import { purchaseStatusAfterReceive } from './purchases.status';
import {
  CreatePurchaseDto,
  CreateSupplierDto,
  ReceivePurchaseDto,
  UpdateSupplierDto,
} from './dto/purchase.dto';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async listSuppliers(actor: RequestUser, search?: string) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.supplier.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({ ...row, paymentBalance: Number(row.paymentBalance) })),
    };
  }

  async createSupplier(actor: RequestUser, dto: CreateSupplierDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const duplicate = await this.prisma.supplier.findFirst({
      where: { tenantId, mobile: dto.mobile.trim() },
    });
    if (duplicate) {
      throw new ConflictException('A supplier with this mobile already exists');
    }
    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: dto.name,
        mobile: dto.mobile.trim(),
        email: dto.email?.toLowerCase(),
        gstNumber: dto.gstNumber,
        address: dto.address,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'supplier.create',
      entityType: 'Supplier',
      entityId: supplier.id,
      ipAddress: ip,
    });
    return { message: 'Supplier created', data: { ...supplier, paymentBalance: 0 } };
  }

  async updateSupplier(actor: RequestUser, id: string, dto: UpdateSupplierDto) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Supplier not found');
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name,
        mobile: dto.mobile,
        email: dto.email?.toLowerCase(),
        gstNumber: dto.gstNumber,
        address: dto.address,
        status: dto.status,
      },
    });
    return { message: 'Supplier updated', data: { ...supplier, paymentBalance: Number(supplier.paymentBalance) } };
  }

  async listPurchases(actor: RequestUser, query: { status?: PurchaseStatus; page?: number; limit?: number }) {
    const tenantId = requireTenantId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          supplier: { select: { id: true, name: true, mobile: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      message: 'OK',
      data: rows.map((row) => ({
        ...row,
        subtotal: Number(row.subtotal),
        taxAmount: Number(row.taxAmount),
        totalAmount: Number(row.totalAmount),
      })),
      meta: paginationMeta(total, page, limit),
    };
  }

  async getPurchase(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const purchase = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { select: { name: true } }, variant: true } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase order not found');
    return { message: 'OK', data: this.serialize(purchase) };
  }

  async createPurchase(actor: RequestUser, dto: CreatePurchaseDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const id = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      const warehouse = dto.warehouseId
        ? await tx.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } })
        : await tx.warehouse.findFirst({ where: { tenantId, isDefault: true } });
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      const items = [];
      for (const line of dto.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: line.variantId, tenantId, product: { deletedAt: null } },
          include: { product: true },
        });
        if (!variant) throw new NotFoundException('Variant not found');
        const unitCost = line.unitCost ?? Number(variant.purchasePrice);
        items.push({
          tenantId,
          productId: variant.productId,
          variantId: variant.id,
          quantityOrdered: line.quantity,
          unitCost,
          lineTotal: roundMoney(unitCost * line.quantity),
        });
      }
      const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
      const purchaseNumber = await this.nextNumber(tx, tenantId);

      const created = await tx.purchaseOrder.create({
        data: {
          tenantId,
          purchaseNumber,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          notes: dto.notes,
          subtotal,
          totalAmount: subtotal,
          items: {
            create: items.map(({ lineTotal: _line, ...item }) => item),
          },
        },
      });
      return created.id;
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'purchase.create',
      entityType: 'PurchaseOrder',
      entityId: id,
      ipAddress: ip,
    });
    return this.getPurchase(actor, id);
  }

  async send(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const purchase = await this.requirePurchase(tenantId, id);
    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new BadRequestException('Only draft purchase orders can be sent');
    }
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseStatus.SENT },
    });
    return this.getPurchase(actor, id);
  }

  async cancel(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const purchase = await this.requirePurchase(tenantId, id);
    if (purchase.status === PurchaseStatus.RECEIVED || purchase.status === PurchaseStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Received purchase orders cannot be cancelled');
    }
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseStatus.CANCELLED },
    });
    return this.getPurchase(actor, id);
  }

  async receive(actor: RequestUser, id: string, dto: ReceivePurchaseDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchaseOrder.findFirst({
        where: { id, tenantId },
        include: { items: true },
      });
      if (!purchase) throw new NotFoundException('Purchase order not found');
      if (purchase.status === PurchaseStatus.DRAFT || purchase.status === PurchaseStatus.CANCELLED) {
        throw new BadRequestException('Send the purchase order before receiving goods');
      }
      if (purchase.status === PurchaseStatus.RECEIVED) {
        throw new BadRequestException('This purchase order is already fully received');
      }

      for (const incoming of dto.items) {
        const item = purchase.items.find((row) => row.id === incoming.itemId);
        if (!item) throw new NotFoundException('Purchase item not found');
        const remaining = item.quantityOrdered - item.quantityReceived;
        if (incoming.quantity > remaining) {
          throw new BadRequestException('Received quantity exceeds the ordered quantity');
        }
        await this.inventory.applyMovement(tx, {
          tenantId,
          variantId: item.variantId,
          warehouseId: purchase.warehouseId,
          type: InventoryTxnType.PURCHASE,
          quantity: incoming.quantity,
          referenceType: 'purchase',
          referenceId: purchase.id,
          createdById: actor.id,
          notes: `GRN ${purchase.purchaseNumber}`,
        });
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { quantityReceived: { increment: incoming.quantity } },
        });
      }

      const refreshed = await tx.purchaseItem.findMany({ where: { purchaseId: id } });
      const ordered = refreshed.reduce((sum, item) => sum + item.quantityOrdered, 0);
      const received = refreshed.reduce((sum, item) => sum + item.quantityReceived, 0);
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: purchaseStatusAfterReceive(ordered, received) },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'purchase.receive',
      entityType: 'PurchaseOrder',
      entityId: id,
      ipAddress: ip,
    });
    return this.getPurchase(actor, id);
  }

  private async requirePurchase(tenantId: string, id: string) {
    const purchase = await this.prisma.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!purchase) throw new NotFoundException('Purchase order not found');
    return purchase;
  }

  private async nextNumber(tx: Prisma.TransactionClient, tenantId: string) {
    const count = await tx.purchaseOrder.count({ where: { tenantId } });
    return `PO${1001 + count}`;
  }

  private serialize(
    purchase: Prisma.PurchaseOrderGetPayload<{
      include: {
        supplier: true;
        warehouse: true;
        items: { include: { product: { select: { name: true } }; variant: true } };
      };
    }>,
  ) {
    return {
      ...purchase,
      subtotal: Number(purchase.subtotal),
      taxAmount: Number(purchase.taxAmount),
      totalAmount: Number(purchase.totalAmount),
      items: purchase.items.map((item) => ({
        ...item,
        unitCost: Number(item.unitCost),
        productName: item.product.name,
        sku: item.variant.sku,
        variantLabel: [item.variant.color, item.variant.size].filter(Boolean).join(' / ') || null,
      })),
    };
  }
}
