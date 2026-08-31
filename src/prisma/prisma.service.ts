import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      // Do not crash the HTTP process on cold start; health will report degraded.
      // eslint-disable-next-line no-console
      console.error('Prisma connect failed', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Always apply tenant isolation from JWT context — never from the request body.
   */
  tenantWhere<T extends Record<string, unknown>>(tenantId: string, extra?: T): T & { tenantId: string } {
    return { ...(extra ?? ({} as T)), tenantId };
  }
}
