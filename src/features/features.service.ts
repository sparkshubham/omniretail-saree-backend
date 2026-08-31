import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureKey, FEATURE_KEYS } from '../common/constants/features';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(tenantId: string, key: FeatureKey): Promise<boolean> {
    const row = await this.prisma.tenantFeature.findUnique({
      where: { tenantId_featureKey: { tenantId, featureKey: key } },
    });
    return row?.isEnabled === true;
  }

  async listForTenant(tenantId: string) {
    const rows = await this.prisma.tenantFeature.findMany({
      where: { tenantId },
      orderBy: { featureKey: 'asc' },
    });
    const present = new Set(rows.map((r) => r.featureKey));
    const missing = FEATURE_KEYS.filter((k) => !present.has(k)).map((featureKey) => ({
      featureKey,
      isEnabled: false,
    }));
    return [...rows, ...missing];
  }

  async setForTenant(tenantId: string, flags: Array<{ featureKey: string; isEnabled: boolean }>) {
    await this.prisma.$transaction(
      flags.map((flag) =>
        this.prisma.tenantFeature.upsert({
          where: { tenantId_featureKey: { tenantId, featureKey: flag.featureKey } },
          update: { isEnabled: flag.isEnabled },
          create: { tenantId, featureKey: flag.featureKey, isEnabled: flag.isEnabled },
        }),
      ),
    );
    return this.listForTenant(tenantId);
  }

  async syncFromPlan(tenantId: string, featureKeys: string[]) {
    const flags = FEATURE_KEYS.map((key) => ({
      featureKey: key,
      isEnabled: featureKeys.includes(key),
    }));
    return this.setForTenant(tenantId, flags);
  }
}
