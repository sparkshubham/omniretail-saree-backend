import { PrismaService } from './prisma.service';

describe('PrismaService.tenantWhere', () => {
  const prisma = new PrismaService();

  it('always injects tenantId from the authenticated context, not the client', () => {
    const spoofed = { tenantId: 'attacker-tenant', sku: 'RED-001' };
    const scoped = prisma.tenantWhere('ganpati-tenant-id', { sku: spoofed.sku });
    expect(scoped.tenantId).toBe('ganpati-tenant-id');
    expect(scoped.sku).toBe('RED-001');
  });

  it('ignores a client-supplied tenantId and keeps the JWT tenant', () => {
    const scoped = prisma.tenantWhere('real-tenant', { tenantId: 'other-tenant' });
    expect(scoped.tenantId).toBe('real-tenant');
  });
});
