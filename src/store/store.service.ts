import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OrderSource,
  PaymentMethod,
  Prisma,
  ProductStatus,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { OrdersService } from '../orders/orders.service';
import { ShippingService } from '../shipping/shipping.service';
import { RequestUser } from '../auth/types/jwt-payload';
import { paginationMeta } from '../common/dto/pagination.dto';
import { availableStock } from '../inventory/inventory.math';
import {
  CreateAddressDto,
  StoreCartItemDto,
  StoreCatalogQueryDto,
  StoreCheckoutDto,
  StoreLoginDto,
  StoreRegisterDto,
} from './dto/store.dto';
import { RequestReturnDto } from '../shipping/dto/shipping.dto';
import { VerifyPaymentDto } from '../orders/dto/order.dto';

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly orders: OrdersService,
    private readonly shipping: ShippingService,
  ) {}

  async boutique(slug: string) {
    const tenant = await this.requireStore(slug);
    const [categoryCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
      this.prisma.product.count({ where: { tenantId: tenant.id, deletedAt: null, status: ProductStatus.ACTIVE } }),
    ]);
    return {
      message: 'OK',
      data: {
        id: tenant.id,
        name: tenant.name,
        businessName: tenant.businessName,
        slug: tenant.slug,
        logo: tenant.logo,
        categoryCount,
        productCount,
      },
    };
  }

  async categories(slug: string) {
    const tenant = await this.requireStore(slug);
    const rows = await this.prisma.category.findMany({
      where: { tenantId: tenant.id, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { message: 'OK', data: rows };
  }

  async products(slug: string, query: StoreCatalogQueryDto) {
    const tenant = await this.requireStore(slug);
    const page = query.page ?? 1;
    const limit = 12;
    const where: Prisma.ProductWhereInput = {
      tenantId: tenant.id,
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    if (query.minPrice != null || query.maxPrice != null) {
      where.sellingPrice = {
        ...(query.minPrice != null ? { gte: query.minPrice } : {}),
        ...(query.maxPrice != null ? { lte: query.maxPrice } : {}),
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          media: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
          variants: { where: { status: 'ACTIVE' }, include: { balances: true } },
        },
      }),
    ]);
    return {
      message: 'OK',
      data: rows.map((product) => this.serializeCatalogProduct(product)),
      meta: paginationMeta(total, page, limit),
    };
  }

  async product(slug: string, id: string) {
    const tenant = await this.requireStore(slug);
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId: tenant.id, deletedAt: null, status: ProductStatus.ACTIVE },
      include: {
        category: true,
        brand: true,
        media: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        variants: { where: { status: 'ACTIVE' }, include: { balances: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return { message: 'OK', data: this.serializeCatalogProduct(product, true) };
  }

  async register(slug: string, dto: StoreRegisterDto) {
    const tenant = await this.requireStore(slug);
    const email = dto.email.toLowerCase().trim();
    const mobile = dto.mobile.trim();
    const existingAccount = await this.prisma.customerAccount.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
    if (existingAccount) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const account = await this.prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({
        where: { tenantId: tenant.id, deletedAt: null, OR: [{ email }, { mobile }] },
      });
      if (customer) {
        const linked = await tx.customerAccount.findUnique({ where: { customerId: customer.id } });
        if (linked) {
          throw new ConflictException('This customer already has a store login');
        }
      } else {
        customer = await tx.customer.create({
          data: {
            tenantId: tenant.id,
            name: dto.name,
            mobile,
            whatsappNumber: mobile,
            email,
          },
        });
      }
      return tx.customerAccount.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          email,
          passwordHash,
        },
      });
    });
    const tokens = await this.auth.issueCustomerTokens(account.id);
    const session = await this.auth.buildCustomerRequestUser(account.id);
    const me = await this.auth.customerProfile(session);
    return { ...tokens, user: me.data };
  }

  async login(slug: string, dto: StoreLoginDto) {
    const tenant = await this.requireStore(slug);
    const email = dto.email.toLowerCase().trim();
    const account = await this.prisma.customerAccount.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await bcrypt.compare(dto.password, account.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (account.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is inactive');
    }
    await this.prisma.customerAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.auth.issueCustomerTokens(account.id);
    const session = await this.auth.buildCustomerRequestUser(account.id);
    const me = await this.auth.customerProfile(session);
    return { ...tokens, user: me.data };
  }

  async me(slug: string, actor: RequestUser) {
    const tenant = await this.assertCustomer(slug, actor);
    const customer = await this.prisma.customer.findFirst({
      where: { id: actor.customerId, tenantId: tenant.id, deletedAt: null },
      include: { addresses: { orderBy: { createdAt: 'asc' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const profile = await this.auth.customerProfile(actor);
    return {
      message: 'OK',
      data: {
        ...profile.data,
        mobile: customer.mobile,
        addresses: customer.addresses,
      },
    };
  }

  async cart(slug: string, actor: RequestUser) {
    const tenant = await this.assertCustomer(slug, actor);
    const cart = await this.ensureCart(tenant.id, actor.customerId as string);
    return this.serializeCart(cart.id);
  }

  async addToCart(slug: string, actor: RequestUser, dto: StoreCartItemDto) {
    const tenant = await this.assertCustomer(slug, actor);
    const variant = await this.requireSellableVariant(tenant.id, dto.variantId);
    const cart = await this.ensureCart(tenant.id, actor.customerId as string);
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: dto.variantId } },
    });
    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + dto.quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          tenantId: tenant.id,
          cartId: cart.id,
          productId: variant.productId,
          variantId: variant.id,
          quantity: dto.quantity,
        },
      });
    }
    return this.serializeCart(cart.id);
  }

  async updateCartItem(slug: string, actor: RequestUser, itemId: string, quantity: number) {
    const tenant = await this.assertCustomer(slug, actor);
    const cart = await this.ensureCart(tenant.id, actor.customerId as string);
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
    if (!item) throw new NotFoundException('Cart item not found');
    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    return this.serializeCart(cart.id);
  }

  async removeCartItem(slug: string, actor: RequestUser, itemId: string) {
    return this.updateCartItem(slug, actor, itemId, 0);
  }

  async wishlist(slug: string, actor: RequestUser) {
    const tenant = await this.assertCustomer(slug, actor);
    const rows = await this.prisma.wishlistItem.findMany({
      where: { tenantId: tenant.id, customerId: actor.customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        variant: {
          include: {
            product: { include: { media: { where: { isPrimary: true }, take: 1 } } },
            balances: true,
          },
        },
      },
    });
    return {
      message: 'OK',
      data: rows.map((row) => ({
        id: row.id,
        variantId: row.variantId,
        productId: row.variant.productId,
        name: row.variant.product.name,
        sku: row.variant.sku,
        color: row.variant.color,
        size: row.variant.size,
        sellingPrice: Number(row.variant.sellingPrice),
        mrp: Number(row.variant.mrp),
        image: row.variant.product.media[0]?.url ?? null,
        availableStock: availableStock(
          row.variant.balances.reduce((s, b) => s + b.physicalQty, 0),
          row.variant.balances.reduce((s, b) => s + b.reservedQty, 0),
        ),
      })),
    };
  }

  async addWishlist(slug: string, actor: RequestUser, variantId: string) {
    const tenant = await this.assertCustomer(slug, actor);
    const variant = await this.requireSellableVariant(tenant.id, variantId);
    await this.prisma.wishlistItem.upsert({
      where: { customerId_variantId: { customerId: actor.customerId as string, variantId } },
      update: {},
      create: {
        tenantId: tenant.id,
        customerId: actor.customerId as string,
        productId: variant.productId,
        variantId,
      },
    });
    return this.wishlist(slug, actor);
  }

  async removeWishlist(slug: string, actor: RequestUser, variantId: string) {
    const tenant = await this.assertCustomer(slug, actor);
    await this.prisma.wishlistItem.deleteMany({
      where: { tenantId: tenant.id, customerId: actor.customerId, variantId },
    });
    return this.wishlist(slug, actor);
  }

  async addresses(slug: string, actor: RequestUser) {
    const tenant = await this.assertCustomer(slug, actor);
    const rows = await this.prisma.customerAddress.findMany({
      where: { tenantId: tenant.id, customerId: actor.customerId },
      orderBy: { createdAt: 'asc' },
    });
    return { message: 'OK', data: rows };
  }

  async addAddress(slug: string, actor: RequestUser, dto: CreateAddressDto) {
    const tenant = await this.assertCustomer(slug, actor);
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { tenantId: tenant.id, customerId: actor.customerId },
        data: { isDefault: false },
      });
    }
    const address = await this.prisma.customerAddress.create({
      data: {
        tenantId: tenant.id,
        customerId: actor.customerId as string,
        label: dto.label ?? 'HOME',
        name: dto.name,
        phone: dto.phone,
        line1: dto.line1,
        line2: dto.line2,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        country: dto.country ?? 'India',
        isDefault: dto.isDefault ?? false,
      },
    });
    return { message: 'Address saved', data: address };
  }

  async checkout(slug: string, actor: RequestUser, dto: StoreCheckoutDto) {
    const tenant = await this.assertCustomer(slug, actor);
    const cart = await this.ensureCart(tenant.id, actor.customerId as string);
    const items = await this.prisma.cartItem.findMany({ where: { cartId: cart.id } });
    if (!items.length) {
      throw new BadRequestException('Your cart is empty');
    }
    const method = dto.paymentMethod ?? PaymentMethod.COD;
    const orderId = await this.orders.createForTenant(
      tenant.id,
      {
        customerId: actor.customerId as string,
        source: OrderSource.WEBSITE,
        paymentMethod: method,
        collectPayment: method === PaymentMethod.COD || method === PaymentMethod.CASH,
        shippingAmount: dto.shippingAmount ?? (method === PaymentMethod.COD ? 0 : 0),
        notes: dto.notes,
        addressId: dto.addressId,
        shippingAddress: dto.shippingAddress,
        items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
      },
      undefined,
    );
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.orders.get(actor, orderId);
  }

  async myOrders(slug: string, actor: RequestUser) {
    await this.assertCustomer(slug, actor);
    return this.orders.list(actor, { customerId: actor.customerId, limit: 50 });
  }

  async myOrder(slug: string, actor: RequestUser, id: string) {
    await this.assertCustomer(slug, actor);
    return this.orders.get(actor, id);
  }

  async pay(slug: string, actor: RequestUser, id: string) {
    await this.assertCustomer(slug, actor);
    return this.orders.createCheckout(actor, id);
  }

  async verify(slug: string, actor: RequestUser, id: string, dto: VerifyPaymentDto) {
    await this.assertCustomer(slug, actor);
    return this.orders.verifyPayment(actor, id, dto);
  }

  async requestReturn(slug: string, actor: RequestUser, id: string, dto: RequestReturnDto) {
    await this.assertCustomer(slug, actor);
    return this.shipping.requestReturn(actor, id, dto);
  }

  async track(slug: string, awb: string) {
    const tenant = await this.requireStore(slug);
    return this.shipping.track(awb, tenant.id);
  }

  private async requireStore(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Store not found');
    }
    if (tenant.status === TenantStatus.SUSPENDED || tenant.status === TenantStatus.INACTIVE) {
      throw new ForbiddenException('This store is not accepting orders');
    }
    return tenant;
  }

  private async assertCustomer(slug: string, actor: RequestUser) {
    const tenant = await this.requireStore(slug);
    if (!actor.isCustomer || actor.tenantId !== tenant.id) {
      throw new ForbiddenException('Sign in to this store to continue');
    }
    return tenant;
  }

  private async ensureCart(tenantId: string, customerId: string) {
    return this.prisma.cart.upsert({
      where: { customerId },
      update: {},
      create: { tenantId, customerId },
    });
  }

  private async requireSellableVariant(tenantId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        tenantId,
        status: 'ACTIVE',
        product: { tenantId, deletedAt: null, status: ProductStatus.ACTIVE },
      },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    return variant;
  }

  private async serializeCart(cartId: string) {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { include: { media: { where: { isPrimary: true }, take: 1 } } },
                balances: true,
              },
            },
          },
        },
      },
    });
    const items = cart.items.map((item) => {
      const sellingPrice = Number(item.variant.sellingPrice);
      const available = availableStock(
        item.variant.balances.reduce((s, b) => s + b.physicalQty, 0),
        item.variant.balances.reduce((s, b) => s + b.reservedQty, 0),
      );
      return {
        id: item.id,
        variantId: item.variantId,
        productId: item.productId,
        name: item.variant.product.name,
        sku: item.variant.sku,
        color: item.variant.color,
        size: item.variant.size,
        quantity: item.quantity,
        unitPrice: sellingPrice,
        lineTotal: sellingPrice * item.quantity,
        image: item.variant.product.media[0]?.url ?? null,
        availableStock: available,
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    return {
      message: 'OK',
      data: {
        id: cart.id,
        items,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal,
      },
    };
  }

  private serializeCatalogProduct(
    product: {
      id: string;
      name: string;
      sku: string;
      description: string | null;
      sellingPrice: Prisma.Decimal;
      mrp: Prisma.Decimal;
      attributes: Prisma.JsonValue;
      category: { id: string; name: string; slug?: string } | null;
      brand?: { id: string; name: string } | null;
      media: Array<{ id?: string; url: string; isPrimary: boolean }>;
      variants: Array<{
        id: string;
        sku: string;
        color: string | null;
        size: string | null;
        sellingPrice: Prisma.Decimal;
        mrp: Prisma.Decimal;
        isDefault?: boolean;
        balances: Array<{ physicalQty: number; reservedQty: number }>;
      }>;
    },
    detail = false,
  ) {
    const physical = product.variants.reduce(
      (sum, variant) => sum + variant.balances.reduce((s, b) => s + b.physicalQty, 0),
      0,
    );
    const reserved = product.variants.reduce(
      (sum, variant) => sum + variant.balances.reduce((s, b) => s + b.reservedQty, 0),
      0,
    );
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      sellingPrice: Number(product.sellingPrice),
      mrp: Number(product.mrp),
      attributes: product.attributes,
      category: product.category,
      brand: product.brand ?? null,
      image: product.media[0]?.url ?? null,
      images: detail ? product.media.map((m) => m.url) : undefined,
      availableStock: availableStock(physical, reserved),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        sellingPrice: Number(variant.sellingPrice),
        mrp: Number(variant.mrp),
        isDefault: variant.isDefault ?? false,
        availableStock: availableStock(
          variant.balances.reduce((s, b) => s + b.physicalQty, 0),
          variant.balances.reduce((s, b) => s + b.reservedQty, 0),
        ),
      })),
    };
  }
}
