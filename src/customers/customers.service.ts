import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAddressDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { PaginationDto, paginationMeta } from '../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { requireTenantId } from '../common/utils/tenant';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser, query: PaginationDto & { search?: string }) {
    const tenantId = requireTenantId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { mobile: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { whatsappNumber: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { addresses: { where: { isDefault: true }, take: 1 } },
      }),
    ]);
    return {
      message: 'OK',
      data: rows.map((c) => ({
        ...c,
        totalPurchase: Number(c.totalPurchase),
      })),
      meta: paginationMeta(total, page, limit),
    };
  }

  async get(actor: RequestUser, id: string) {
    const tenantId = requireTenantId(actor);
    const customer = await this.prisma.customer.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
      include: { addresses: { orderBy: { createdAt: 'asc' } } },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return {
      message: 'OK',
      data: {
        ...customer,
        totalPurchase: Number(customer.totalPurchase),
        orderHistory: [] as unknown[],
        favouriteProducts: [] as unknown[],
        returnHistory: [] as unknown[],
        whatsappConversations: [] as unknown[],
      },
    };
  }

  async create(actor: RequestUser, dto: CreateCustomerDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const mobile = dto.mobile.trim();
    const duplicate = await this.prisma.customer.findFirst({
      where: this.prisma.tenantWhere(tenantId, { mobile, deletedAt: null }),
    });
    if (duplicate) {
      throw new ConflictException('A customer with this mobile already exists');
    }
    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        name: dto.name,
        mobile,
        whatsappNumber: dto.whatsappNumber ?? mobile,
        email: dto.email?.toLowerCase(),
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        notes: dto.notes,
        addresses: dto.address
          ? {
              create: {
                tenantId,
                label: dto.address.label ?? 'HOME',
                name: dto.address.name ?? dto.name,
                phone: dto.address.phone ?? mobile,
                line1: dto.address.line1,
                line2: dto.address.line2,
                city: dto.address.city,
                state: dto.address.state,
                pincode: dto.address.pincode,
                country: dto.address.country ?? 'India',
                isDefault: true,
              },
            }
          : undefined,
      },
      include: { addresses: true },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'customer.create',
      entityType: 'Customer',
      entityId: customer.id,
      newData: { name: customer.name, mobile } as Prisma.InputJsonObject,
      ipAddress: ip,
    });
    return { message: 'Customer created', data: { ...customer, totalPurchase: 0 } };
  }

  async update(actor: RequestUser, id: string, dto: UpdateCustomerDto, ip?: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.customer.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
    });
    if (!existing) {
      throw new NotFoundException('Customer not found');
    }
    if (dto.mobile && dto.mobile !== existing.mobile) {
      const duplicate = await this.prisma.customer.findFirst({
        where: this.prisma.tenantWhere(tenantId, { mobile: dto.mobile, deletedAt: null }),
      });
      if (duplicate) {
        throw new ConflictException('A customer with this mobile already exists');
      }
    }
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        mobile: dto.mobile,
        whatsappNumber: dto.whatsappNumber,
        email: dto.email?.toLowerCase(),
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        notes: dto.notes,
        status: dto.status,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'customer.update',
      entityType: 'Customer',
      entityId: id,
      ipAddress: ip,
    });
    return { message: 'Customer updated', data: { ...customer, totalPurchase: Number(customer.totalPurchase) } };
  }

  async addAddress(actor: RequestUser, customerId: string, dto: CreateAddressDto) {
    const tenantId = requireTenantId(actor);
    const customer = await this.prisma.customer.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id: customerId, deletedAt: null }),
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { tenantId, customerId },
        data: { isDefault: false },
      });
    }
    const address = await this.prisma.customerAddress.create({
      data: {
        tenantId,
        customerId,
        label: dto.label ?? 'HOME',
        name: dto.name ?? customer.name,
        phone: dto.phone ?? customer.mobile,
        line1: dto.line1,
        line2: dto.line2,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        country: dto.country ?? 'India',
        isDefault: dto.isDefault ?? false,
      },
    });
    return { message: 'Address added', data: address };
  }
}
