import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { PaginationDto, paginationMeta } from '../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/jwt-payload';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tenantId = this.scopedTenantId(actor);

    const where = {
      deletedAt: null,
      ...(tenantId ? { tenantId } : { tenantId: { not: null } }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          mobile: true,
          status: true,
          tenantId: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: { select: { role: { select: { slug: true, name: true } } } },
        },
      }),
    ]);

    return {
      message: 'OK',
      data: rows.map(({ userRoles, ...u }) => ({
        ...u,
        roles: userRoles.map((r) => r.role.slug),
      })),
      meta: paginationMeta(total, page, limit),
    };
  }

  async create(actor: RequestUser, dto: CreateStaffDto, ip?: string) {
    const tenantId = this.requireTenant(actor);
    const email = dto.email.toLowerCase();
    const duplicate = await this.prisma.user.findFirst({
      where: { email, tenantId, deletedAt: null },
    });
    if (duplicate) {
      throw new ConflictException('A staff member with this email already exists');
    }

    const role = await this.prisma.role.findFirst({
      where: { slug: dto.role, isSystem: true },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        mobile: dto.mobile,
        passwordHash: await bcrypt.hash(dto.password, 12),
        status: UserStatus.ACTIVE,
        userRoles: { create: { roleId: role.id } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        mobile: true,
        status: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      newData: { email, role: dto.role },
      ipAddress: ip,
    });

    return { message: 'Staff member created', data: { ...user, roles: [dto.role] } };
  }

  async update(actor: RequestUser, id: string, dto: UpdateStaffDto, ip?: string) {
    const tenantId = this.requireTenant(actor);
    const existing = await this.prisma.user.findFirst({
      where: this.prisma.tenantWhere(tenantId, { id, deletedAt: null }),
    });
    if (!existing) {
      throw new NotFoundException('Staff member not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        mobile: dto.mobile,
        status: dto.status,
      },
    });

    if (dto.role) {
      const role = await this.prisma.role.findFirst({
        where: { slug: dto.role, isSystem: true },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.create({ data: { userId: id, roleId: role.id } });
    }

    await this.audit.log({
      tenantId,
      userId: actor.id,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      oldData: { firstName: existing.firstName, status: existing.status },
      newData: { firstName: dto.firstName ?? existing.firstName, status: dto.status ?? existing.status },
      ipAddress: ip,
    });

    return { message: 'Staff member updated', data: { id } };
  }

  async roles() {
    const rows = await this.prisma.role.findMany({
      where: { isSystem: true, slug: { not: SYSTEM_ROLES.SUPER_ADMIN } },
      select: { id: true, name: true, slug: true, description: true },
      orderBy: { name: 'asc' },
    });
    return { message: 'OK', data: rows };
  }

  private scopedTenantId(actor: RequestUser): string | null {
    if (actor.isSuperAdmin) {
      return null;
    }
    return this.requireTenant(actor);
  }

  private requireTenant(actor: RequestUser): string {
    if (!actor.tenantId) {
      throw new ForbiddenException('Tenant context is required');
    }
    return actor.tenantId;
  }
}
