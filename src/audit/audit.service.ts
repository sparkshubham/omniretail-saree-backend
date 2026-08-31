import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    oldData?: Prisma.InputJsonValue;
    newData?: Prisma.InputJsonValue;
    ipAddress?: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        oldData: input.oldData,
        newData: input.newData,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }
}
