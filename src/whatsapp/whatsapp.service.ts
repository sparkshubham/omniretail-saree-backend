import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderSource, PaymentMethod, WhatsAppConnectionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import {
  ConnectWhatsAppDto,
  CreateWhatsAppOrderDto,
  SendMessageDto,
  SimulateInboundDto,
} from './dto/whatsapp.dto';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async status(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { tenantId } });
    return {
      message: 'OK',
      data: connection
        ? {
            phoneNumber: connection.phoneNumber,
            businessAccountId: connection.businessAccountId,
            status: connection.status,
            connected: connection.status === WhatsAppConnectionStatus.CONNECTED,
          }
        : { phoneNumber: null, status: WhatsAppConnectionStatus.DISCONNECTED, connected: false },
    };
  }

  async connect(actor: RequestUser, dto: ConnectWhatsAppDto) {
    const tenantId = requireTenantId(actor);
    const connection = await this.prisma.whatsAppConnection.upsert({
      where: { tenantId },
      update: {
        phoneNumber: dto.phoneNumber,
        businessAccountId: dto.businessAccountId,
        accessTokenEnc: dto.accessToken ? this.encryption.encrypt(dto.accessToken) : undefined,
        status: WhatsAppConnectionStatus.CONNECTED,
      },
      create: {
        tenantId,
        phoneNumber: dto.phoneNumber,
        businessAccountId: dto.businessAccountId,
        accessTokenEnc: dto.accessToken ? this.encryption.encrypt(dto.accessToken) : null,
        status: WhatsAppConnectionStatus.CONNECTED,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'whatsapp.connect',
      entityType: 'WhatsAppConnection',
      entityId: connection.id,
    });
    return this.status(actor);
  }

  async disconnect(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    await this.prisma.whatsAppConnection.updateMany({
      where: { tenantId },
      data: { status: WhatsAppConnectionStatus.DISCONNECTED, accessTokenEnc: null },
    });
    return this.status(actor);
  }

  async threads(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.whatsAppThread.findMany({
      where: { tenantId },
      orderBy: { lastMessageAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({
        id: row.id,
        phone: row.phone,
        customerId: row.customerId,
        lastMessageAt: row.lastMessageAt,
        lastMessage: row.messages[0]?.body ?? null,
      })),
    };
  }

  async thread(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const row = await this.prisma.whatsAppThread.findFirst({
      where: { id, tenantId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return { message: 'OK', data: row };
  }

  async simulateInbound(actor: RequestUser, dto: SimulateInboundDto) {
    const tenantId = requireTenantId(actor);
    await this.assertConnected(tenantId);
    const phone = dto.phone.trim();
    const customer =
      (await this.prisma.customer.findFirst({
        where: { tenantId, deletedAt: null, OR: [{ mobile: phone }, { whatsappNumber: phone }] },
      })) ??
      (await this.prisma.customer.create({
        data: {
          tenantId,
          name: dto.customerName ?? `WhatsApp ${phone}`,
          mobile: phone,
          whatsappNumber: phone,
        },
      }));

    const thread = await this.prisma.whatsAppThread.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: { lastMessageAt: new Date(), customerId: customer.id },
      create: { tenantId, phone, customerId: customer.id },
    });
    const message = await this.prisma.whatsAppMessage.create({
      data: { tenantId, threadId: thread.id, direction: 'INBOUND', body: dto.body },
    });
    return { message: 'Inbound message stored', data: { threadId: thread.id, message } };
  }

  async send(actor: RequestUser, threadId: string, dto: SendMessageDto) {
    const tenantId = requireTenantId(actor);
    await this.assertConnected(tenantId);
    const thread = await this.prisma.whatsAppThread.findFirst({ where: { id: threadId, tenantId } });
    if (!thread) throw new NotFoundException('Conversation not found');
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        tenantId,
        threadId,
        direction: 'OUTBOUND',
        body: dto.body,
        template: dto.template,
      },
    });
    await this.prisma.whatsAppThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });
    return { message: 'Message sent (mock)', data: message };
  }

  async createOrder(actor: RequestUser, threadId: string, dto: CreateWhatsAppOrderDto) {
    const tenantId = requireTenantId(actor);
    const thread = await this.prisma.whatsAppThread.findFirst({ where: { id: threadId, tenantId } });
    if (!thread?.customerId) {
      throw new BadRequestException('Link a customer to this conversation first');
    }
    return this.orders.create(actor, {
      customerId: thread.customerId,
      source: OrderSource.WHATSAPP,
      paymentMethod: PaymentMethod.CASH,
      collectPayment: false,
      notes: dto.notes ?? `Created from WhatsApp ${thread.phone}`,
      items: dto.items,
    });
  }

  private async assertConnected(tenantId: string) {
    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { tenantId } });
    if (!connection || connection.status !== WhatsAppConnectionStatus.CONNECTED) {
      throw new BadRequestException('Connect WhatsApp before using the inbox');
    }
  }
}
