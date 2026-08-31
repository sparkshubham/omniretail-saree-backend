import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryTxnType,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentProviderKind,
  PaymentStatus,
  Prisma,
  StockCommitment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { paginationMeta } from '../common/dto/pagination.dto';
import {
  CollectPaymentDto,
  CreateOrderDto,
  OrderQueryDto,
  PaymentWebhookDto,
  UpdateOrderStatusDto,
  VerifyPaymentDto,
} from './dto/order.dto';
import { canTransition, DISPATCH_STATUSES, nextStatuses, PACK_STATUSES } from './order-status';
import { PERMISSIONS } from '../common/constants/permissions';
import { roundMoney } from '../common/utils/money';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser, query: OrderQueryDto) {
    const tenantId = requireTenantId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
              { customer: { mobile: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, mobile: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      message: 'OK',
      data: rows.map((row) => this.serializeList(row)),
      meta: paginationMeta(total, page, limit),
    };
  }

  async get(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const order = await this.prisma.order.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
      include: this.detailInclude(),
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    this.assertOrderAccess(actor, order);
    return { message: 'OK', data: this.serializeDetail(order, actor) };
  }

  async create(actor: RequestUser, dto: CreateOrderDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    if (actor.isCustomer) {
      throw new ForbiddenException('Use store checkout to place this order');
    }
    const orderId = await this.createForTenant(tenantId, dto, actor.id);
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'order.create',
      entityType: 'Order',
      entityId: orderId,
      newData: { source: dto.source ?? OrderSource.MANUAL } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, orderId);
  }

  async createForTenant(tenantId: string, dto: CreateOrderDto, createdById?: string) {
    const collectNow = dto.collectPayment ?? this.defaultCollect(dto.paymentMethod ?? PaymentMethod.CASH);
    const initialStatus = collectNow ? OrderStatus.CONFIRMED : OrderStatus.PENDING_PAYMENT;
    const lines = this.mergeLines(dto.items);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, tenantId, deletedAt: null },
      });
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const warehouse = dto.warehouseId
        ? await tx.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } })
        : await tx.warehouse.findFirst({ where: { tenantId, isDefault: true } });
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found');
      }

      const shippingAddress = await this.resolveAddress(tx, tenantId, customer.id, dto);
      const builtItems = await this.buildSnapshots(tx, tenantId, lines);
      const subtotal = builtItems.reduce((sum, item) => sum + item.lineBeforeTax, 0);
      const taxAmount = builtItems.reduce((sum, item) => sum + item.tax, 0);
      const discountAmount = builtItems.reduce((sum, item) => sum + item.discount, 0);
      const shippingAmount = dto.shippingAmount ?? 0;
      const totalAmount = roundMoney(subtotal - discountAmount + taxAmount + shippingAmount);

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const orderNumber = await this.nextOrderNumber(tx, tenantId, tenant.slug);

      const created = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          source: dto.source ?? OrderSource.MANUAL,
          customerId: customer.id,
          warehouseId: warehouse.id,
          status: initialStatus,
          stockState: StockCommitment.RESERVED,
          subtotal,
          discountAmount,
          taxAmount,
          shippingAmount,
          totalAmount,
          paymentStatus: collectNow ? PaymentStatus.PAID : PaymentStatus.PENDING,
          paymentMethod: dto.paymentMethod ?? PaymentMethod.CASH,
          notes: dto.notes,
          ...(shippingAddress
            ? { shippingAddress: shippingAddress as Prisma.InputJsonObject }
            : {}),
          createdById,
          items: {
            create: builtItems.map((item) => ({
              tenantId,
              productId: item.productId,
              variantId: item.variantId,
              sku: item.sku,
              productName: item.productName,
              variantLabel: item.variantLabel,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxRate: item.taxRate,
              tax: item.tax,
              total: item.total,
            })),
          },
        },
      });

      for (const item of builtItems) {
        await this.inventory.applyMovement(tx, {
          tenantId,
          variantId: item.variantId,
          warehouseId: warehouse.id,
          type: InventoryTxnType.RESERVATION,
          quantity: item.quantity,
          referenceType: 'order',
          referenceId: created.id,
          createdById,
          notes: `Reserve ${created.orderNumber}`,
        });
      }

      if (collectNow) {
        await this.commitStock(tx, tenantId, created.id, warehouse.id, builtItems, createdById, created.orderNumber);
        await tx.order.update({
          where: { id: created.id },
          data: { stockState: StockCommitment.COMMITTED },
        });
        await tx.payment.create({
          data: {
            tenantId,
            orderId: created.id,
            provider: PaymentProviderKind.MOCK,
            providerPaymentId: `mock_cash_${created.id}`,
            amount: totalAmount,
            status: PaymentStatus.PAID,
            method: dto.paymentMethod ?? PaymentMethod.CASH,
            idempotencyKey: `order-${created.id}-collect`,
          },
        });
        await this.bumpCustomerTotals(tx, customer.id, totalAmount, 1);
      }

      return created.id;
    });
  }

  async updateStatus(actor: RequestUser, id: string, dto: UpdateOrderStatusDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const order = await this.prisma.order.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!canTransition(order.status, dto.status)) {
      throw new BadRequestException(`Cannot move from ${order.status} to ${dto.status}`);
    }
    this.assertStatusPermission(actor, dto.status);

    await this.prisma.$transaction(async (tx) => {
      if (dto.status === OrderStatus.CANCELLED) {
        await this.releaseReservation(tx, order, actor.id);
      }
      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          cancelledReason: dto.status === OrderStatus.CANCELLED ? dto.reason : undefined,
          cancelledAt: dto.status === OrderStatus.CANCELLED ? new Date() : undefined,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'order.status',
      entityType: 'Order',
      entityId: id,
      oldData: { status: order.status } as Prisma.InputJsonObject,
      newData: { status: dto.status } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async collectPayment(actor: RequestUser, id: string, dto: CollectPaymentDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const order = await this.requireOrder(tenantId, id);
    this.assertOrderAccess(actor, order);
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }
    this.assertPayable(order.status);

    const provider = this.payments.getProvider(PaymentProviderKind.MOCK);
    const created = await provider.createPayment({
      amount: Number(order.totalAmount),
      currency: 'INR',
      orderId: order.id,
      orderNumber: order.orderNumber,
      idempotencyKey: `order-${order.id}-pay`,
    });
    const verified = await provider.verifyPayment({ providerPaymentId: created.providerPaymentId });
    if (!verified.success) {
      throw new BadRequestException('Payment verification failed');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.markPaid(tx, order, {
        actorId: actor.id,
        providerPaymentId: created.providerPaymentId,
        method: dto.method ?? order.paymentMethod,
        idempotencyKey: `order-${order.id}-pay`,
        rawPayload: { notes: dto.notes ?? null },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'order.pay',
      entityType: 'Order',
      entityId: id,
      newData: { amount: Number(order.totalAmount) } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async createCheckout(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const order = await this.requireOrder(tenantId, id);
    this.assertOrderAccess(actor, order);
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }
    const idempotencyKey = `order-${order.id}-checkout`;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        message: 'Payment session created',
        data: {
          providerPaymentId: existing.providerPaymentId,
          checkoutUrl: null,
          provider: existing.provider,
        },
      };
    }

    const result = await this.payments.getProvider(PaymentProviderKind.MOCK).createPayment({
      amount: Number(order.totalAmount),
      currency: 'INR',
      orderId: order.id,
      orderNumber: order.orderNumber,
      idempotencyKey,
    });

    await this.prisma.payment.create({
      data: {
        tenantId,
        orderId: order.id,
        provider: PaymentProviderKind.MOCK,
        providerPaymentId: result.providerPaymentId,
        amount: order.totalAmount,
        status: PaymentStatus.PENDING,
        method: order.paymentMethod,
        idempotencyKey,
      },
    });

    return {
      message: 'Payment session created',
      data: { ...result, provider: PaymentProviderKind.MOCK },
    };
  }

  async verifyPayment(actor: RequestUser, id: string, dto: VerifyPaymentDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const order = await this.requireOrder(tenantId, id);
    this.assertOrderAccess(actor, order);
    const verified = await this.payments
      .getProvider(PaymentProviderKind.MOCK)
      .verifyPayment({ providerPaymentId: dto.providerPaymentId });
    if (!verified.success) {
      throw new BadRequestException('Payment verification failed');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.markPaid(tx, order, {
        actorId: actor.id,
        providerPaymentId: dto.providerPaymentId,
        method: order.paymentMethod,
        idempotencyKey: `order-${order.id}-verify`,
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'order.pay.verify',
      entityType: 'Order',
      entityId: id,
      newData: { providerPaymentId: dto.providerPaymentId } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async handleWebhook(dto: PaymentWebhookDto) {
    const existing = await this.prisma.payment.findFirst({
      where: { providerPaymentId: dto.providerPaymentId },
      include: { order: { include: { items: true } } },
    });
    const order =
      existing?.order ??
      (dto.orderId
        ? await this.prisma.order.findFirst({ where: { id: dto.orderId }, include: { items: true } })
        : null);
    if (!order) {
      throw new NotFoundException('Order not found for payment webhook');
    }
    if (existing?.status === PaymentStatus.PAID || order.paymentStatus === PaymentStatus.PAID) {
      return { message: 'Payment already recorded', data: { orderId: order.id, status: PaymentStatus.PAID } };
    }

    const verified = await this.payments
      .getProvider(PaymentProviderKind.MOCK)
      .verifyPayment({ providerPaymentId: dto.providerPaymentId });
    if (!verified.success) {
      throw new BadRequestException('Payment verification failed');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.markPaid(tx, order, {
        actorId: order.createdById ?? undefined,
        providerPaymentId: dto.providerPaymentId,
        method: order.paymentMethod,
        idempotencyKey: existing?.idempotencyKey ?? `webhook-${dto.providerPaymentId}`,
      });
    });

    return { message: 'Payment recorded', data: { orderId: order.id, status: PaymentStatus.PAID } };
  }

  async stats(tenantId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const paidToday = await this.prisma.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: start },
        paymentStatus: PaymentStatus.PAID,
        status: { not: OrderStatus.CANCELLED },
      },
      select: { totalAmount: true, source: true },
    });
    const todayOrders = await this.prisma.order.count({
      where: { tenantId, createdAt: { gte: start } },
    });
    const pendingOrders = await this.prisma.order.count({
      where: {
        tenantId,
        status: {
          in: [OrderStatus.NEW, OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.PROCESSING],
        },
      },
    });
    const salesByChannel: Record<string, number> = {
      WHATSAPP: 0,
      AMAZON: 0,
      FLIPKART: 0,
      WEBSITE: 0,
      MANUAL: 0,
    };
    let todaySales = 0;
    for (const row of paidToday) {
      const amount = Number(row.totalAmount);
      todaySales += amount;
      salesByChannel[row.source] = (salesByChannel[row.source] ?? 0) + amount;
    }
    return { todaySales, todayOrders, pendingOrders, salesByChannel };
  }

  private assertOrderAccess(actor: RequestUser, order: { customerId: string }) {
    if (actor.isCustomer && actor.customerId !== order.customerId) {
      throw new NotFoundException('Order not found');
    }
  }

  private defaultCollect(method: PaymentMethod) {
    return method === PaymentMethod.CASH || method === PaymentMethod.COD;
  }

  private assertPayable(status: OrderStatus) {
    const payable: OrderStatus[] = [OrderStatus.NEW, OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED];
    if (!payable.includes(status)) {
      throw new BadRequestException('This order cannot accept payment in its current status');
    }
  }

  private assertStatusPermission(actor: RequestUser, status: OrderStatus) {
    if (actor.isSuperAdmin) return;
    if (PACK_STATUSES.includes(status)) {
      if (!actor.permissions.includes(PERMISSIONS.ORDERS_PACK)) {
        throw new ForbiddenException('Packing permission required');
      }
      return;
    }
    if (DISPATCH_STATUSES.includes(status)) {
      if (!actor.permissions.includes(PERMISSIONS.ORDERS_DISPATCH)) {
        throw new ForbiddenException('Dispatch permission required');
      }
      return;
    }
    if (!actor.permissions.includes(PERMISSIONS.ORDERS_WRITE)) {
      throw new ForbiddenException('Order write permission required');
    }
  }

  private async requireOrder(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async markPaid(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      tenantId: string;
      warehouseId: string;
      orderNumber: string;
      customerId: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
      stockState: StockCommitment;
      totalAmount: Prisma.Decimal;
      items: Array<{ variantId: string; quantity: number }>;
    },
    input: {
      actorId?: string;
      providerPaymentId: string;
      method: PaymentMethod;
      idempotencyKey: string;
      rawPayload?: Record<string, unknown>;
    },
  ) {
    if (order.paymentStatus === PaymentStatus.PAID) {
      return;
    }
    const prior = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!prior) {
      await tx.payment.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          provider: PaymentProviderKind.MOCK,
          providerPaymentId: input.providerPaymentId,
          amount: order.totalAmount,
          status: PaymentStatus.PAID,
          method: input.method,
          idempotencyKey: input.idempotencyKey,
          rawPayload: (input.rawPayload ?? undefined) as Prisma.InputJsonObject | undefined,
        },
      });
    } else if (prior.status !== PaymentStatus.PAID) {
      await tx.payment.update({
        where: { id: prior.id },
        data: { status: PaymentStatus.PAID, providerPaymentId: input.providerPaymentId },
      });
    }

    if (order.stockState === StockCommitment.RESERVED) {
      await this.commitStock(
        tx,
        order.tenantId,
        order.id,
        order.warehouseId,
        order.items,
        input.actorId,
        order.orderNumber,
      );
    }

    const nextStatus =
      order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.NEW
        ? OrderStatus.CONFIRMED
        : order.status;
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: input.method,
        status: nextStatus,
        stockState: StockCommitment.COMMITTED,
      },
    });
    await this.bumpCustomerTotals(tx, order.customerId, Number(order.totalAmount), 1);
  }

  private async commitStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    warehouseId: string,
    items: Array<{ variantId: string; quantity: number }>,
    userId: string | undefined,
    orderNumber: string,
  ) {
    for (const item of items) {
      await this.inventory.applyMovement(tx, {
        tenantId,
        variantId: item.variantId,
        warehouseId,
        type: InventoryTxnType.RESERVATION_RELEASE,
        quantity: item.quantity,
        referenceType: 'order',
        referenceId: orderId,
        createdById: userId,
        notes: `Commit ${orderNumber}`,
      });
      await this.inventory.applyMovement(tx, {
        tenantId,
        variantId: item.variantId,
        warehouseId,
        type: InventoryTxnType.SALE,
        quantity: item.quantity,
        referenceType: 'order',
        referenceId: orderId,
        createdById: userId,
        notes: `Sale ${orderNumber}`,
      });
    }
  }

  private async releaseReservation(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      tenantId: string;
      warehouseId: string;
      orderNumber: string;
      stockState: StockCommitment;
      items: Array<{ variantId: string; quantity: number }>;
    },
    userId: string,
  ) {
    if (order.stockState !== StockCommitment.RESERVED) {
      return;
    }
    for (const item of order.items) {
      await this.inventory.applyMovement(tx, {
        tenantId: order.tenantId,
        variantId: item.variantId,
        warehouseId: order.warehouseId,
        type: InventoryTxnType.RESERVATION_RELEASE,
        quantity: item.quantity,
        referenceType: 'order',
        referenceId: order.id,
        createdById: userId,
        notes: `Cancel ${order.orderNumber}`,
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: { stockState: StockCommitment.RELEASED },
    });
  }

  private mergeLines(items: CreateOrderDto['items']) {
    const merged = new Map<string, CreateOrderDto['items'][number]>();
    for (const item of items) {
      const prior = merged.get(item.variantId);
      if (prior) {
        prior.quantity += item.quantity;
        prior.discount = (prior.discount ?? 0) + (item.discount ?? 0);
      } else {
        merged.set(item.variantId, { ...item });
      }
    }
    return [...merged.values()];
  }

  private async buildSnapshots(
    tx: Prisma.TransactionClient,
    tenantId: string,
    items: CreateOrderDto['items'],
  ) {
    const snapshots = [];
    for (const line of items) {
      const variant = await tx.productVariant.findFirst({
        where: { id: line.variantId, tenantId, status: 'ACTIVE', product: { deletedAt: null, tenantId } },
        include: { product: true },
      });
      if (!variant) {
        throw new NotFoundException('Variant not found');
      }
      const quantity = line.quantity;
      const unitPrice = Number(variant.sellingPrice);
      const discount = line.discount ?? 0;
      const taxRate = Number(variant.product.gstRate);
      const lineBeforeTax = roundMoney(unitPrice * quantity);
      const taxable = roundMoney(Math.max(lineBeforeTax - discount, 0));
      const tax = roundMoney((taxable * taxRate) / 100);
      const total = roundMoney(taxable + tax);
      snapshots.push({
        productId: variant.productId,
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        variantLabel: [variant.color, variant.size].filter(Boolean).join(' / ') || null,
        quantity,
        unitPrice,
        discount,
        taxRate,
        tax,
        lineBeforeTax,
        total,
      });
    }
    return snapshots;
  }

  private async resolveAddress(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
    dto: CreateOrderDto,
  ) {
    if (dto.shippingAddress) {
      return { ...dto.shippingAddress, country: dto.shippingAddress.country ?? 'India' };
    }
    const address = dto.addressId
      ? await tx.customerAddress.findFirst({ where: { id: dto.addressId, tenantId, customerId } })
      : await tx.customerAddress.findFirst({ where: { tenantId, customerId, isDefault: true } });
    if (!address) {
      return null;
    }
    return {
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
    };
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient, tenantId: string, slug: string) {
    const prefix = slug.replace(/-/g, '').slice(0, 2).toUpperCase() || 'OR';
    const count = await tx.order.count({ where: { tenantId } });
    let n = 1001 + count;
    for (let i = 0; i < 8; i += 1) {
      const orderNumber = `${prefix}${n}`;
      const exists = await tx.order.findFirst({ where: { tenantId, orderNumber } });
      if (!exists) return orderNumber;
      n += 1;
    }
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  private async bumpCustomerTotals(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: number,
    orders: number,
  ) {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: { increment: orders },
        totalPurchase: { increment: amount },
        lastOrderDate: new Date(),
      },
    });
  }

  private detailInclude() {
    return {
      customer: { select: { id: true, name: true, mobile: true, email: true, whatsappNumber: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      items: true,
      payments: { orderBy: { createdAt: 'desc' as const } },
      shipments: { orderBy: { createdAt: 'desc' as const } },
      returns: { orderBy: { createdAt: 'desc' as const } },
    };
  }

  private serializeList(row: {
    id: string;
    orderNumber: string;
    source: OrderSource;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    totalAmount: Prisma.Decimal;
    createdAt: Date;
    customer: { id: string; name: string; mobile: string };
    warehouse: { id: string; name: string; code: string };
    _count: { items: number };
  }) {
    return {
      ...row,
      totalAmount: Number(row.totalAmount),
    };
  }

  private serializeDetail(
    order: Prisma.OrderGetPayload<{ include: ReturnType<OrdersService['detailInclude']> }>,
    actor: RequestUser,
  ) {
    return {
      ...order,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      taxAmount: Number(order.taxAmount),
      shippingAmount: Number(order.shippingAmount),
      totalAmount: Number(order.totalAmount),
      items: order.items.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        taxRate: Number(item.taxRate),
        tax: Number(item.tax),
        total: Number(item.total),
      })),
      payments: order.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
      nextStatuses: nextStatuses(order.status).filter((status) => {
        if (actor.isSuperAdmin) return true;
        if (PACK_STATUSES.includes(status) && !actor.permissions.includes(PERMISSIONS.ORDERS_PACK)) return false;
        if (DISPATCH_STATUSES.includes(status) && !actor.permissions.includes(PERMISSIONS.ORDERS_DISPATCH)) {
          return false;
        }
        if (
          !PACK_STATUSES.includes(status) &&
          !DISPATCH_STATUSES.includes(status) &&
          !actor.permissions.includes(PERMISSIONS.ORDERS_WRITE)
        ) {
          return false;
        }
        return true;
      }),
    };
  }
}
