import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MarketplaceAccountStatus,
  MarketplacePlatform,
  OrderSource,
  PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { ConnectMarketplaceDto, ImportMarketplaceOrderDto, MapListingDto } from './dto/marketplace.dto';

@Injectable()
export class MarketplacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.marketplaceAccount.findMany({
      where: { tenantId },
      include: { _count: { select: { listings: true, orders: true } } },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        sellerId: row.sellerId,
        status: row.status,
        listingCount: row._count.listings,
        orderCount: row._count.orders,
      })),
    };
  }

  async connect(actor: RequestUser, dto: ConnectMarketplaceDto) {
    const tenantId = requireTenantId(actor);
    const account = await this.prisma.marketplaceAccount.upsert({
      where: { tenantId_platform: { tenantId, platform: dto.platform } },
      update: {
        sellerId: dto.sellerId,
        credentialsEnc: dto.apiKey ? this.encryption.encrypt(dto.apiKey) : undefined,
        status: MarketplaceAccountStatus.CONNECTED,
      },
      create: {
        tenantId,
        platform: dto.platform,
        sellerId: dto.sellerId,
        credentialsEnc: dto.apiKey ? this.encryption.encrypt(dto.apiKey) : null,
        status: MarketplaceAccountStatus.CONNECTED,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'marketplace.connect',
      entityType: 'MarketplaceAccount',
      entityId: account.id,
      newData: { platform: dto.platform },
    });
    return this.list(actor);
  }

  async listings(actor: RequestUser, platform: MarketplacePlatform) {
    const tenantId = requireTenantId(actor);
    const account = await this.requireAccount(tenantId, platform);
    const rows = await this.prisma.marketplaceListing.findMany({
      where: { tenantId, accountId: account.id },
      include: { variant: { include: { product: { select: { name: true } } } } },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({
        id: row.id,
        externalSku: row.externalSku,
        variantId: row.variantId,
        sku: row.variant.sku,
        productName: row.variant.product.name,
      })),
    };
  }

  async mapListing(actor: RequestUser, platform: MarketplacePlatform, dto: MapListingDto) {
    const tenantId = requireTenantId(actor);
    const account = await this.requireAccount(tenantId, platform);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, tenantId },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    const listing = await this.prisma.marketplaceListing.upsert({
      where: {
        tenantId_accountId_externalSku: {
          tenantId,
          accountId: account.id,
          externalSku: dto.externalSku,
        },
      },
      update: { variantId: dto.variantId },
      create: {
        tenantId,
        accountId: account.id,
        variantId: dto.variantId,
        externalSku: dto.externalSku,
      },
    });
    return { message: 'Listing mapped', data: listing };
  }

  async importOrder(actor: RequestUser, dto: ImportMarketplaceOrderDto) {
    const tenantId = requireTenantId(actor);
    const account = await this.requireAccount(tenantId, dto.platform);
    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: {
        tenantId_platform_externalOrderId: {
          tenantId,
          platform: dto.platform,
          externalOrderId: dto.externalOrderId,
        },
      },
    });
    if (existing) {
      return this.orders.get(actor, existing.orderId);
    }

    const items = [];
    for (const line of dto.items) {
      const listing = await this.prisma.marketplaceListing.findUnique({
        where: {
          tenantId_accountId_externalSku: {
            tenantId,
            accountId: account.id,
            externalSku: line.externalSku,
          },
        },
      });
      if (!listing) {
        throw new BadRequestException(`No listing mapped for SKU ${line.externalSku}`);
      }
      items.push({ variantId: listing.variantId, quantity: line.quantity });
    }

    const customer =
      (await this.prisma.customer.findFirst({
        where: { tenantId, mobile: dto.customerMobile, deletedAt: null },
      })) ??
      (await this.prisma.customer.create({
        data: {
          tenantId,
          name: dto.customerName,
          mobile: dto.customerMobile,
          whatsappNumber: dto.customerMobile,
        },
      }));

    const created = await this.orders.create(actor, {
      customerId: customer.id,
      source: dto.platform === MarketplacePlatform.AMAZON ? OrderSource.AMAZON : OrderSource.FLIPKART,
      paymentMethod: PaymentMethod.CASH,
      collectPayment: true,
      notes: dto.notes ?? `Imported ${dto.platform} ${dto.externalOrderId}`,
      items,
    });

    await this.prisma.marketplaceOrder.create({
      data: {
        tenantId,
        accountId: account.id,
        platform: dto.platform,
        externalOrderId: dto.externalOrderId,
        orderId: created.data.id,
        rawPayload: dto as unknown as object,
      },
    });
    return created;
  }

  private async requireAccount(tenantId: string, platform: MarketplacePlatform) {
    const account = await this.prisma.marketplaceAccount.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });
    if (!account || account.status !== MarketplaceAccountStatus.CONNECTED) {
      throw new BadRequestException(`${platform} is not connected`);
    }
    return account;
  }
}
