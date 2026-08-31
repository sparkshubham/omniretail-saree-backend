import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { TenantStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload, RequestUser } from './types/jwt-payload';
import { SYSTEM_ROLES } from '../common/constants/roles';
import { FEATURE_KEYS } from '../common/constants/features';
import { AuditService } from '../audit/audit.service';

const PLATFORM_TENANT = null;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, ip?: string) {
    const email = dto.email.toLowerCase().trim();
    const slug = dto.slug.toLowerCase().trim();

    const slugTaken = await this.prisma.tenant.findUnique({ where: { slug } });
    if (slugTaken) {
      throw new ConflictException('This company slug is already taken');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const basicPlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'basic' } });
    if (!basicPlan) {
      throw new ForbiddenException('Subscription plans are not configured');
    }

    const companyAdminRole = await this.prisma.role.findFirst({
      where: { slug: SYSTEM_ROLES.COMPANY_ADMIN, isSystem: true },
    });
    if (!companyAdminRole) {
      throw new ForbiddenException('System roles are not seeded');
    }

    const trialStart = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.companyName,
          businessName: dto.companyName,
          slug,
          email,
          mobile: dto.mobile,
          status: TenantStatus.TRIAL,
          trialStartDate: trialStart,
          trialEndDate: trialEnd,
        },
      });

      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: basicPlan.id,
          status: 'TRIAL',
          startDate: trialStart,
          endDate: trialEnd,
        },
      });

      await tx.tenantFeature.createMany({
        data: FEATURE_KEYS.map((key) => ({
          tenantId: tenant.id,
          featureKey: key,
          isEnabled: basicPlan.featureKeys.includes(key),
        })),
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          mobile: dto.mobile,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: companyAdminRole.id },
      });

      await tx.warehouse.create({
        data: {
          tenantId: tenant.id,
          name: 'Main Warehouse',
          code: 'MAIN',
          isDefault: true,
        },
      });

      return { tenant, user };
    });

    await this.audit.log({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'tenant.register',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newData: { slug, email },
      ipAddress: ip,
    });

    const tokens = await this.issueTokens(result.user.id);
    const me = await this.staffProfile(result.user.id);
    return { ...tokens, user: me.data };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    const slug = dto.tenantSlug?.toLowerCase().trim();

    const user = slug
      ? await this.findTenantUser(email, slug)
      : await this.findPlatformUser(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email, password, or company');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email, password, or company');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is inactive');
    }

    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || tenant.deletedAt) {
        throw new ForbiddenException('Company not found');
      }
      if (tenant.status === TenantStatus.SUSPENDED) {
        throw new ForbiddenException('This company has been suspended');
      }
      if (tenant.status === TenantStatus.INACTIVE) {
        throw new ForbiddenException('This company is inactive');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, { ip, userAgent });
    const me = await this.staffProfile(user.id);
    return { ...tokens, user: me.data };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (stored && !stored.revokedAt && stored.expiresAt >= new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      const tokens = await this.issueTokens(stored.userId);
      const me = await this.staffProfile(stored.userId);
      return { ...tokens, user: me.data };
    }

    const customerStored = await this.prisma.customerRefreshToken.findUnique({
      where: { tokenHash },
    });
    if (!customerStored || customerStored.revokedAt || customerStored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.customerRefreshToken.update({
      where: { id: customerStored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issueCustomerTokens(customerStored.accountId);
    const session = await this.buildCustomerRequestUser(customerStored.accountId);
    const me = await this.customerProfile(session);
    return { ...tokens, user: me.data };
  }

  async logout(user: RequestUser, refreshToken?: string) {
    if (user.isCustomer) {
      if (refreshToken) {
        await this.prisma.customerRefreshToken.updateMany({
          where: { accountId: user.id, tokenHash: this.hashToken(refreshToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        await this.prisma.customerRefreshToken.updateMany({
          where: { accountId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return { message: 'Logged out successfully', data: null };
    }
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, tokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out successfully', data: null };
  }

  async me(actor: RequestUser) {
    if (actor.isCustomer) {
      return this.customerProfile(actor);
    }
    return this.staffProfile(actor.id);
  }

  async staffProfile(userId: string) {
    const session = await this.buildRequestUser(userId);
    const tenant = session.tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: session.tenantId },
          select: { id: true, name: true, slug: true, status: true, logo: true },
        })
      : null;
    const features = session.tenantId
      ? await this.prisma.tenantFeature.findMany({
          where: { tenantId: session.tenantId, isEnabled: true },
          select: { featureKey: true },
        })
      : [];
    return {
      message: 'OK',
      data: {
        ...this.publicUser(session),
        tenant,
        features: features.map((f) => f.featureKey),
      },
    };
  }

  async customerProfile(actor: RequestUser) {
    if (!actor.tenantId || !actor.customerId) {
      throw new UnauthorizedException('Customer session is invalid');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: actor.tenantId },
      select: { id: true, name: true, slug: true, status: true, logo: true },
    });
    const customer = await this.prisma.customer.findFirst({
      where: { id: actor.customerId, tenantId: actor.tenantId, deletedAt: null },
      select: { id: true, name: true, mobile: true, email: true },
    });
    return {
      message: 'OK',
      data: {
        ...this.publicUser(actor),
        mobile: customer?.mobile ?? null,
        customerName: customer?.name ?? `${actor.firstName} ${actor.lastName}`.trim(),
        tenant,
        features: [] as string[],
      },
    };
  }

  async validateJwtPayload(payload: JwtPayload): Promise<RequestUser> {
    if (payload.kind === 'customer') {
      return this.buildCustomerRequestUser(payload.sub);
    }
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: UserStatus.ACTIVE },
    });
    if (!user) {
      throw new UnauthorizedException('User is no longer active');
    }
    if (payload.tenantId && user.tenantId && payload.tenantId !== user.tenantId) {
      throw new UnauthorizedException('Tenant mismatch');
    }
    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || tenant.status === TenantStatus.SUSPENDED || tenant.deletedAt) {
        throw new UnauthorizedException('Company is not accessible');
      }
    }
    return this.buildRequestUser(user.id);
  }

  async buildRequestUser(userId: string): Promise<RequestUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    const roles = user.userRoles.map((ur) => ur.role.slug);
    const permissions = [
      ...new Set(user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))),
    ];
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions,
      isSuperAdmin: roles.includes(SYSTEM_ROLES.SUPER_ADMIN),
      isCustomer: false,
    };
  }

  async buildCustomerRequestUser(accountId: string): Promise<RequestUser> {
    const account = await this.prisma.customerAccount.findFirst({
      where: { id: accountId, status: UserStatus.ACTIVE },
      include: { customer: true, tenant: true },
    });
    if (!account || account.customer.deletedAt) {
      throw new UnauthorizedException('Customer account is no longer active');
    }
    if (
      account.tenant.deletedAt ||
      account.tenant.status === TenantStatus.SUSPENDED ||
      account.tenant.status === TenantStatus.INACTIVE
    ) {
      throw new UnauthorizedException('Store is not accessible');
    }
    const parts = account.customer.name.trim().split(/\s+/);
    const firstName = parts[0] ?? 'Customer';
    const lastName = parts.slice(1).join(' ');
    return {
      id: account.id,
      tenantId: account.tenantId,
      email: account.email,
      firstName,
      lastName,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
      isCustomer: true,
      customerId: account.customerId,
    };
  }

  async issueCustomerTokens(accountId: string) {
    const session = await this.buildCustomerRequestUser(accountId);
    const payload: JwtPayload = {
      sub: session.id,
      tenantId: session.tenantId,
      email: session.email,
      roles: [],
      kind: 'customer',
      customerId: session.customerId,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('hex');
    const days = this.parseDurationDays(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await this.prisma.customerRefreshToken.create({
      data: {
        accountId,
        tenantId: session.tenantId as string,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    };
  }

  private publicUser(user: RequestUser) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions,
      isSuperAdmin: user.isSuperAdmin,
      isCustomer: Boolean(user.isCustomer),
      customerId: user.customerId ?? null,
    };
  }

  private async findPlatformUser(email: string) {
    return this.prisma.user.findFirst({
      where: { email, tenantId: PLATFORM_TENANT, deletedAt: null },
    });
  }

  private async findTenantUser(email: string, slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      return null;
    }
    return this.prisma.user.findFirst({
      where: { email, tenantId: tenant.id, deletedAt: null },
    });
  }

  private async issueTokens(userId: string, meta?: { ip?: string; userAgent?: string }) {
    const session = await this.buildRequestUser(userId);
    const payload: JwtPayload = {
      sub: session.id,
      tenantId: session.tenantId,
      email: session.email,
      roles: session.roles,
      kind: 'staff',
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('hex');
    const days = this.parseDurationDays(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDurationDays(value: string): number {
    const match = /^(\d+)d$/.exec(value);
    return match ? Number(match[1]) : 7;
  }
}
