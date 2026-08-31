import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateMediaDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { PaginationDto, paginationMeta } from '../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { availableStock } from '../inventory/inventory.math';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser, query: PaginationDto & { search?: string; categoryId?: string; status?: ProductStatus }) {
    const tenantId = requireTenantId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { productCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          media: { where: { isPrimary: true }, take: 1 },
          variants: { include: { balances: true } },
        },
      }),
    ]);

    return {
      message: 'OK',
      data: rows.map((product) => {
        const physical = product.variants.reduce(
          (sum, v) => sum + v.balances.reduce((s, b) => s + b.physicalQty, 0),
          0,
        );
        const reserved = product.variants.reduce(
          (sum, v) => sum + v.balances.reduce((s, b) => s + b.reservedQty, 0),
          0,
        );
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          status: product.status,
          sellingPrice: Number(product.sellingPrice),
          mrp: Number(product.mrp),
          category: product.category,
          brand: product.brand,
          image: product.media[0]?.url ?? null,
          variantCount: product.variants.length,
          physicalStock: physical,
          reservedStock: reserved,
          availableStock: availableStock(physical, reserved),
          attributes: product.attributes,
        };
      }),
      meta: paginationMeta(total, page, limit),
    };
  }

  async get(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const product = await this.prisma.product.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
      include: {
        category: true,
        brand: true,
        media: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        variants: { include: { balances: { include: { warehouse: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return { message: 'OK', data: this.serialize(product) };
  }

  async create(actor: RequestUser, dto: CreateProductDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const sku = dto.sku.trim().toUpperCase();
    await this.assertSkuFree(tenantId, sku);

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: this.prisma.tenantWhere(tenantId, { id: dto.categoryId }),
      });
      if (!category) throw new NotFoundException('Category not found');
    }
    if (dto.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: this.prisma.tenantWhere(tenantId, { id: dto.brandId }),
      });
      if (!brand) throw new NotFoundException('Brand not found');
    }

    const variants = dto.variants?.length
      ? dto.variants
      : [{ sku, purchasePrice: dto.purchasePrice, sellingPrice: dto.sellingPrice, mrp: dto.mrp, minimumStockLevel: 0 }];

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          tenantId,
          name: dto.name,
          productCode: dto.productCode,
          sku,
          barcode: dto.barcode,
          categoryId: dto.categoryId,
          brandId: dto.brandId,
          description: dto.description,
          purchasePrice: dto.purchasePrice ?? 0,
          sellingPrice: dto.sellingPrice,
          mrp: dto.mrp ?? dto.sellingPrice,
          discount: dto.discount ?? 0,
          gstRate: dto.gstRate ?? 0,
          hsnCode: dto.hsnCode,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonObject,
          allowNegativeStock: dto.allowNegativeStock ?? false,
          status: dto.status ?? ProductStatus.ACTIVE,
        },
      });

      await this.createVariants(tx, tenantId, created.id, created.sku, dto, variants);
      return created;
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'product.create',
      entityType: 'Product',
      entityId: product.id,
      newData: { name: product.name, sku } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, product.id);
  }

  async update(actor: RequestUser, id: string, dto: UpdateProductDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.product.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        productCode: dto.productCode,
        barcode: dto.barcode,
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        brandId: dto.brandId === undefined ? undefined : dto.brandId,
        description: dto.description,
        purchasePrice: dto.purchasePrice,
        sellingPrice: dto.sellingPrice,
        mrp: dto.mrp,
        discount: dto.discount,
        gstRate: dto.gstRate,
        hsnCode: dto.hsnCode,
        attributes: dto.attributes as Prisma.InputJsonObject | undefined,
        allowNegativeStock: dto.allowNegativeStock,
        status: dto.status,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'product.update',
      entityType: 'Product',
      entityId: id,
      oldData: { name: existing.name, sellingPrice: existing.sellingPrice.toString() } as Prisma.InputJsonObject,
      newData: { name: dto.name ?? existing.name, sellingPrice: String(dto.sellingPrice ?? existing.sellingPrice) } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async remove(actor: RequestUser, id: string, ip?: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.product.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.ARCHIVED },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'product.delete',
      entityType: 'Product',
      entityId: id,
      ipAddress: ip,
    });
    return { message: 'Product deleted', data: null };
  }

  async addVariant(actor: RequestUser, productId: string, dto: CreateVariantDto) {
    const tenantId = requireTenantId(actor);
    const product = await this.prisma.product.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id: productId, deletedAt: null }),
    });
    if (!product) throw new NotFoundException('Product not found');
    const sku = (dto.sku ?? `${product.sku}-${dto.color ?? dto.size ?? Date.now()}`).toUpperCase();
    await this.assertSkuFree(tenantId, sku);
    const variant = await this.prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        sku,
        barcode: dto.barcode,
        color: dto.color,
        size: dto.size,
        purchasePrice: dto.purchasePrice ?? Number(product.purchasePrice),
        sellingPrice: dto.sellingPrice ?? Number(product.sellingPrice),
        mrp: dto.mrp ?? Number(product.mrp),
        minimumStockLevel: dto.minimumStockLevel ?? 0,
      },
    });
    return { message: 'Variant created', data: variant };
  }

  async updateVariant(actor: RequestUser, productId: string, variantId: string, dto: UpdateVariantDto) {
    const tenantId = requireTenantId(actor);
    const variant = await this.prisma.productVariant.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id: variantId, productId }),
    });
    if (!variant) throw new NotFoundException('Variant not found');
    if (dto.sku && dto.sku.toUpperCase() !== variant.sku) {
      await this.assertSkuFree(tenantId, dto.sku.toUpperCase());
    }
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        sku: dto.sku?.toUpperCase(),
        color: dto.color,
        size: dto.size,
        purchasePrice: dto.purchasePrice,
        sellingPrice: dto.sellingPrice,
        mrp: dto.mrp,
        minimumStockLevel: dto.minimumStockLevel,
        status: dto.status,
      },
    });
    return { message: 'Variant updated', data: updated };
  }

  async addMedia(actor: RequestUser, productId: string, dto: CreateMediaDto) {
    const tenantId = requireTenantId(actor);
    const product = await this.prisma.product.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id: productId, deletedAt: null }),
    });
    if (!product) throw new NotFoundException('Product not found');
    if (dto.isPrimary) {
      await this.prisma.productMedia.updateMany({
        where: { tenantId, productId },
        data: { isPrimary: false },
      });
    }
    const media = await this.prisma.productMedia.create({
      data: {
        tenantId,
        productId,
        url: dto.url,
        type: dto.type ?? 'IMAGE',
        isPrimary: dto.isPrimary ?? false,
      },
    });
    return { message: 'Media added', data: media };
  }

  private serialize(product: Prisma.ProductGetPayload<{
    include: {
      category: true;
      brand: true;
      media: true;
      variants: { include: { balances: { include: { warehouse: true } } } };
    };
  }>) {
    return {
      ...product,
      purchasePrice: Number(product.purchasePrice),
      sellingPrice: Number(product.sellingPrice),
      mrp: Number(product.mrp),
      discount: Number(product.discount),
      gstRate: Number(product.gstRate),
      variants: product.variants.map((variant) => {
        const physical = variant.balances.reduce((s, b) => s + b.physicalQty, 0);
        const reserved = variant.balances.reduce((s, b) => s + b.reservedQty, 0);
        return {
          ...variant,
          purchasePrice: Number(variant.purchasePrice),
          sellingPrice: Number(variant.sellingPrice),
          mrp: Number(variant.mrp),
          physicalStock: physical,
          reservedStock: reserved,
          availableStock: availableStock(physical, reserved),
          balances: variant.balances.map((b) => ({
            ...b,
            availableQty: availableStock(b.physicalQty, b.reservedQty),
          })),
        };
      }),
    };
  }

  private async assertSkuFree(tenantId: string, sku: string) {
    const [product, variant] = await Promise.all([
      this.prisma.product.findFirst({ where: { tenantId, sku, deletedAt: null } }),
      this.prisma.productVariant.findFirst({ where: { tenantId, sku } }),
    ]);
    if (product || variant) {
      throw new ConflictException('SKU already exists in this company');
    }
  }

  private async createVariants(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    productSku: string,
    product: CreateProductDto,
    variants: CreateVariantDto[],
  ) {
    let index = 0;
    for (const variant of variants) {
      const sku = (variant.sku ?? (index === 0 ? productSku : `${productSku}-${index + 1}`)).toUpperCase();
      const clash = await tx.productVariant.findFirst({ where: { tenantId, sku } });
      if (clash) {
        throw new ConflictException(`Variant SKU ${sku} already exists`);
      }
      await tx.productVariant.create({
        data: {
          tenantId,
          productId,
          sku,
          barcode: variant.barcode,
          color: variant.color,
          size: variant.size,
          purchasePrice: variant.purchasePrice ?? product.purchasePrice ?? 0,
          sellingPrice: variant.sellingPrice ?? product.sellingPrice,
          mrp: variant.mrp ?? product.mrp ?? product.sellingPrice,
          minimumStockLevel: variant.minimumStockLevel ?? 0,
          isDefault: index === 0,
        },
      });
      index += 1;
    }
  }
}
