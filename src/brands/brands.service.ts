import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';
import { slugify } from '../common/utils/slug';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: RequestUser) {
    const tenantId = requireTenantId(actor);
    const data = await this.prisma.brand.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return { message: 'OK', data };
  }

  async create(actor: RequestUser, dto: CreateBrandDto) {
    const tenantId = requireTenantId(actor);
    const slug = await this.uniqueSlug(tenantId, slugify(dto.name));
    const brand = await this.prisma.brand.create({
      data: { tenantId, name: dto.name, slug },
    });
    return { message: 'Brand created', data: brand };
  }

  async update(actor: RequestUser, id: string, dto: UpdateBrandDto) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.brand.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id }),
    });
    if (!existing) {
      throw new NotFoundException('Brand not found');
    }
    const brand = await this.prisma.brand.update({
      where: { id },
      data: { name: dto.name, status: dto.status },
    });
    return { message: 'Brand updated', data: brand };
  }

  private async uniqueSlug(tenantId: string, base: string) {
    let slug = base;
    let i = 2;
    while (await this.prisma.brand.findFirst({ where: { tenantId, slug } })) {
      slug = `${base}-${i}`;
      i += 1;
    }
    return slug;
  }
}
