import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { slugify } from '../common/utils/slug';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { message: 'OK', data: rows };
  }

  async tree(actor: RequestUser) {
    const { data } = await this.list(actor);
    const byParent = new Map<string | null, typeof data>();
    for (const row of data) {
      const key = row.parentId;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }
    const nest = (parentId: string | null): Array<(typeof data)[number] & { children: unknown[] }> =>
      (byParent.get(parentId) ?? []).map((row) => ({ ...row, children: nest(row.id) }));
    return { message: 'OK', data: nest(null) };
  }

  async create(actor: RequestUser, dto: CreateCategoryDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const slug = await this.uniqueSlug(tenantId, dto.slug || slugify(dto.name));
    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: this.prisma.tenantWhere(tenantId, { id: dto.parentId }),
      });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }
    const category = await this.prisma.category.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        parentId: dto.parentId,
        image: dto.image,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'category.create',
      entityType: 'Category',
      entityId: category.id,
      newData: { name: category.name, slug } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return { message: 'Category created', data: category };
  }

  async update(actor: RequestUser, id: string, dto: UpdateCategoryDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.category.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
    });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    if (dto.parentId === id) {
      throw new ConflictException('A category cannot be its own parent');
    }
    const category = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        image: dto.image,
        status: dto.status,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'category.update',
      entityType: 'Category',
      entityId: id,
      ipAddress: ip,
    });
    return { message: 'Category updated', data: category };
  }

  private async uniqueSlug(tenantId: string, base: string) {
    let slug = base;
    let i = 2;
    while (await this.prisma.category.findFirst({ where: { tenantId, slug } })) {
      slug = `${base}-${i}`;
      i += 1;
    }
    return slug;
  }
}
