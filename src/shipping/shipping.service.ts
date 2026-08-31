import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryTxnType,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
  ShipmentStatus,
  ShippingProviderKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { CreateShipmentDto, DecideReturnDto, RequestReturnDto } from './dto/shipping.dto';

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async listShipments(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.shipment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { orderNumber: true, status: true } } },
    });
    return { message: 'OK', data: rows };
  }

  async createShipment(actor: RequestUser, dto: CreateShipmentDto) {
    const tenantId = requireTenantId(actor);
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot ship a cancelled order');
    }
    const awb = `MOCK${Date.now().toString().slice(-10)}`;
    const shipment = await this.prisma.shipment.create({
      data: {
        tenantId,
        orderId: order.id,
        warehouseId: order.warehouseId,
        provider: dto.provider ?? ShippingProviderKind.MOCK,
        awb,
        trackingUrl: `/s/track/${awb}`,
        status: ShipmentStatus.LABELLED,
        labelUrl: `https://labels.local/${awb}.pdf`,
      },
    });
    if (
      order.status === OrderStatus.READY_TO_SHIP ||
      order.status === OrderStatus.PACKING ||
      order.status === OrderStatus.PROCESSING ||
      order.status === OrderStatus.CONFIRMED
    ) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.SHIPPED },
      });
    }
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'shipment.create',
      entityType: 'Shipment',
      entityId: shipment.id,
    });
    return { message: 'Shipment created', data: shipment };
  }

  async markInTransit(actor: RequestUser, id: string) {
    return this.updateShipment(actor, id, ShipmentStatus.IN_TRANSIT);
  }

  async markDelivered(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const shipment = await this.prisma.shipment.findFirst({ where: { id, tenantId } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id }, data: { status: ShipmentStatus.DELIVERED } }),
      this.prisma.order.update({ where: { id: shipment.orderId }, data: { status: OrderStatus.DELIVERED } }),
    ]);
    return { message: 'Delivered', data: await this.prisma.shipment.findUniqueOrThrow({ where: { id } }) };
  }

  async track(awb: string, tenantId?: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { awb, ...(tenantId ? { tenantId } : {}) },
      include: { order: { select: { orderNumber: true, status: true } } },
    });
    if (!shipment) throw new NotFoundException('Tracking number not found');
    return {
      message: 'OK',
      data: {
        awb: shipment.awb,
        status: shipment.status,
        provider: shipment.provider,
        orderNumber: shipment.order.orderNumber,
        trackingUrl: shipment.trackingUrl,
        events: this.mockEvents(shipment.status, shipment.createdAt),
      },
    };
  }

  async listReturns(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.returnRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { orderNumber: true, totalAmount: true, status: true } },
        customer: { select: { name: true, mobile: true } },
      },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({ ...row, order: { ...row.order, totalAmount: Number(row.order.totalAmount) } })),
    };
  }

  async requestReturn(actor: RequestUser, orderId: string, dto: RequestReturnDto) {
    const tenantId = requireTenantId(actor);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Order not found');
    if (actor.isCustomer && actor.customerId !== order.customerId) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException('Returns can be requested after the order is shipped');
    }
    const existing = await this.prisma.returnRequest.findFirst({
      where: { orderId, tenantId, status: { in: [ReturnStatus.REQUESTED, ReturnStatus.APPROVED] } },
    });
    if (existing) throw new BadRequestException('A return is already in progress for this order');

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.returnRequest.create({
        data: {
          tenantId,
          orderId,
          customerId: order.customerId,
          reason: dto.reason,
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.RETURN_REQUESTED },
      });
      return created;
    });
    return { message: 'Return requested', data: request };
  }

  async approveReturn(actor: RequestUser, id: string, dto: DecideReturnDto) {
    return this.advanceReturn(actor, id, ReturnStatus.APPROVED, OrderStatus.RETURN_APPROVED, dto);
  }

  async rejectReturn(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const request = await this.prisma.returnRequest.findFirst({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('Return not found');
    await this.prisma.$transaction([
      this.prisma.returnRequest.update({ where: { id }, data: { status: ReturnStatus.REJECTED } }),
      this.prisma.order.update({ where: { id: request.orderId }, data: { status: OrderStatus.DELIVERED } }),
    ]);
    return { message: 'Return rejected', data: await this.prisma.returnRequest.findUniqueOrThrow({ where: { id } }) };
  }

  async receiveReturn(actor: RequestUser, id: string, dto: DecideReturnDto) {
    const tenantId = requireTenantId(actor);
    const request = await this.prisma.returnRequest.findFirst({
      where: { id, tenantId },
      include: { order: { include: { items: true } } },
    });
    if (!request) throw new NotFoundException('Return not found');
    if (request.status !== ReturnStatus.APPROVED) {
      throw new BadRequestException('Approve the return before receiving it');
    }
    const restock = dto.restock ?? request.restock;
    await this.prisma.$transaction(async (tx) => {
      for (const item of request.order.items) {
        await this.inventory.applyMovement(tx, {
          tenantId,
          variantId: item.variantId,
          warehouseId: request.order.warehouseId,
          type: restock ? InventoryTxnType.SALE_RETURN : InventoryTxnType.DAMAGE,
          quantity: item.quantity,
          referenceType: 'return',
          referenceId: request.id,
          createdById: actor.id,
          notes: restock ? `Restock ${request.order.orderNumber}` : `Damage ${request.order.orderNumber}`,
        });
      }
      await tx.returnRequest.update({
        where: { id },
        data: { status: ReturnStatus.RECEIVED, restock },
      });
      await tx.order.update({
        where: { id: request.orderId },
        data: { status: OrderStatus.RETURN_RECEIVED },
      });
    });
    return { message: 'Return received', data: await this.prisma.returnRequest.findUniqueOrThrow({ where: { id } }) };
  }

  async refundReturn(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const request = await this.prisma.returnRequest.findFirst({
      where: { id, tenantId },
      include: { order: { include: { payments: true } } },
    });
    if (!request) throw new NotFoundException('Return not found');
    if (request.status !== ReturnStatus.RECEIVED) {
      throw new BadRequestException('Receive the return before refunding');
    }
    const payment = request.order.payments.find((row) => row.status === PaymentStatus.PAID);
    if (payment) {
      await this.payments.getProvider(payment.provider).refundPayment({
        providerPaymentId: payment.providerPaymentId ?? payment.id,
        amount: Number(request.order.totalAmount),
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });
    }
    await this.prisma.$transaction([
      this.prisma.returnRequest.update({ where: { id }, data: { status: ReturnStatus.REFUNDED } }),
      this.prisma.order.update({
        where: { id: request.orderId },
        data: { status: OrderStatus.REFUNDED, paymentStatus: PaymentStatus.REFUNDED },
      }),
    ]);
    return { message: 'Refund processed', data: await this.prisma.returnRequest.findUniqueOrThrow({ where: { id } }) };
  }

  private async updateShipment(actor: RequestUser, id: string, status: ShipmentStatus) {
    const tenantId = requireTenantId(actor);
    const shipment = await this.prisma.shipment.findFirst({ where: { id, tenantId } });
    if (!shipment) throw new NotFoundException('Shipment not found');
    const updated = await this.prisma.shipment.update({ where: { id }, data: { status } });
    return { message: 'Shipment updated', data: updated };
  }

  private async advanceReturn(
    actor: RequestUser,
    id: string,
    status: ReturnStatus,
    orderStatus: OrderStatus,
    dto: DecideReturnDto,
  ) {
    const tenantId = requireTenantId(actor);
    const request = await this.prisma.returnRequest.findFirst({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('Return not found');
    await this.prisma.$transaction([
      this.prisma.returnRequest.update({
        where: { id },
        data: { status, restock: dto.restock ?? request.restock },
      }),
      this.prisma.order.update({ where: { id: request.orderId }, data: { status: orderStatus } }),
    ]);
    return { message: 'Return updated', data: await this.prisma.returnRequest.findUniqueOrThrow({ where: { id } }) };
  }

  private mockEvents(status: ShipmentStatus, createdAt: Date) {
    const events = [{ status: 'CREATED', at: createdAt, note: 'Label generated (mock courier)' }];
    if (status === ShipmentStatus.DISPATCHED || status === ShipmentStatus.IN_TRANSIT || status === ShipmentStatus.DELIVERED) {
      events.push({ status: 'DISPATCHED', at: createdAt, note: 'Handed to courier' });
    }
    if (status === ShipmentStatus.IN_TRANSIT || status === ShipmentStatus.DELIVERED) {
      events.push({ status: 'IN_TRANSIT', at: createdAt, note: 'In transit to destination' });
    }
    if (status === ShipmentStatus.DELIVERED) {
      events.push({ status: 'DELIVERED', at: createdAt, note: 'Delivered to customer' });
    }
    return events;
  }
}
