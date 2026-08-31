import { PrismaClient, TenantStatus, UserStatus, SubscriptionStatus, BillingCycle, InventoryTxnType, OrderSource, OrderStatus, PaymentStatus, PaymentMethod, PaymentProviderKind, StockCommitment, WhatsAppConnectionStatus, MarketplacePlatform, MarketplaceAccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const FEATURE_KEYS = [
  'ENABLE_WHATSAPP',
  'ENABLE_AMAZON',
  'ENABLE_FLIPKART',
  'ENABLE_SHIPPING',
  'ENABLE_MULTI_WAREHOUSE',
  'ENABLE_API_ACCESS',
  'ENABLE_CUSTOM_DOMAIN',
  'ENABLE_ADVANCED_REPORTS',
] as const;

const PERMISSIONS: Array<{ key: string; name: string; module: string }> = [
  { key: 'platform:read', name: 'View platform', module: 'platform' },
  { key: 'platform:write', name: 'Manage platform', module: 'platform' },
  { key: 'tenants:read', name: 'View companies', module: 'tenants' },
  { key: 'tenants:write', name: 'Manage companies', module: 'tenants' },
  { key: 'plans:read', name: 'View plans', module: 'subscriptions' },
  { key: 'plans:write', name: 'Manage plans', module: 'subscriptions' },
  { key: 'users:read', name: 'View staff', module: 'users' },
  { key: 'users:write', name: 'Manage staff', module: 'users' },
  { key: 'products:read', name: 'View products', module: 'products' },
  { key: 'products:write', name: 'Manage products', module: 'products' },
  { key: 'inventory:read', name: 'View inventory', module: 'inventory' },
  { key: 'inventory:write', name: 'Manage inventory', module: 'inventory' },
  { key: 'warehouses:read', name: 'View warehouses', module: 'warehouses' },
  { key: 'warehouses:write', name: 'Manage warehouses', module: 'warehouses' },
  { key: 'purchases:read', name: 'View purchases', module: 'purchases' },
  { key: 'purchases:write', name: 'Manage purchases', module: 'purchases' },
  { key: 'customers:read', name: 'View customers', module: 'customers' },
  { key: 'customers:write', name: 'Manage customers', module: 'customers' },
  { key: 'orders:read', name: 'View orders', module: 'orders' },
  { key: 'orders:write', name: 'Manage orders', module: 'orders' },
  { key: 'orders:pack', name: 'Pack orders', module: 'orders' },
  { key: 'orders:dispatch', name: 'Dispatch orders', module: 'orders' },
  { key: 'payments:read', name: 'View payments', module: 'payments' },
  { key: 'payments:write', name: 'Manage payments', module: 'payments' },
  { key: 'reports:read', name: 'View reports', module: 'reports' },
  { key: 'reports:gst', name: 'View GST reports', module: 'reports' },
  { key: 'integrations:read', name: 'View integrations', module: 'integrations' },
  { key: 'integrations:write', name: 'Manage integrations', module: 'integrations' },
  { key: 'settings:read', name: 'View settings', module: 'settings' },
  { key: 'settings:write', name: 'Manage settings', module: 'settings' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  COMPANY_ADMIN: PERMISSIONS.filter(
    (p) => !p.key.startsWith('platform:') && !p.key.startsWith('tenants:') && !p.key.startsWith('plans:'),
  ).map((p) => p.key),
  INVENTORY_MANAGER: [
    'products:read',
    'products:write',
    'inventory:read',
    'inventory:write',
    'warehouses:read',
    'warehouses:write',
    'purchases:read',
    'purchases:write',
  ],
  SALES_STAFF: ['customers:read', 'customers:write', 'orders:read', 'orders:write', 'products:read'],
  PACKING_STAFF: ['orders:read', 'orders:pack', 'products:read'],
  DISPATCH_STAFF: ['orders:read', 'orders:dispatch', 'products:read'],
  ACCOUNTANT: ['payments:read', 'payments:write', 'reports:read', 'reports:gst', 'orders:read', 'purchases:read'],
};

async function upsertPermissions() {
  const records = [];
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { name: p.name, module: p.module },
      create: p,
    });
    records.push(row);
  }
  return new Map(records.map((r) => [r.key, r.id]));
}

async function upsertRoles(permissionIds: Map<string, string>) {
  const roles: Record<string, { id: string }> = {};
  for (const [slug, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const existing = await prisma.role.findFirst({ where: { slug, tenantId: null } });
    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { name: slug.replaceAll('_', ' '), isSystem: true },
        })
      : await prisma.role.create({
          data: {
            name: slug.replaceAll('_', ' '),
            slug,
            tenantId: null,
            isSystem: true,
            description: `System role ${slug}`,
          },
        });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys.map((key) => ({
        roleId: role.id,
        permissionId: permissionIds.get(key) as string,
      })),
    });
    roles[slug] = role;
  }
  return roles;
}

async function seedPlans() {
  const basic = await prisma.subscriptionPlan.upsert({
    where: { slug: 'basic' },
    update: {},
    create: {
      name: 'Basic',
      slug: 'basic',
      description: 'Products, inventory, customers, manual orders, and reports.',
      priceMonthly: 2999,
      priceYearly: 29990,
      featureKeys: [],
      sortOrder: 1,
    },
  });

  const professional = await prisma.subscriptionPlan.upsert({
    where: { slug: 'professional' },
    update: {},
    create: {
      name: 'Professional',
      slug: 'professional',
      description: 'Everything in Basic plus WhatsApp, Amazon, Flipkart, and shipping.',
      priceMonthly: 5999,
      priceYearly: 59990,
      featureKeys: ['ENABLE_WHATSAPP', 'ENABLE_AMAZON', 'ENABLE_FLIPKART', 'ENABLE_SHIPPING'],
      sortOrder: 2,
    },
  });

  const enterprise = await prisma.subscriptionPlan.upsert({
    where: { slug: 'enterprise' },
    update: {},
    create: {
      name: 'Enterprise',
      slug: 'enterprise',
      description: 'All features, multi-warehouse, API access, custom domain, advanced reports.',
      priceMonthly: 0,
      priceYearly: 0,
      isCustom: true,
      featureKeys: [...FEATURE_KEYS],
      sortOrder: 3,
    },
  });

  return { basic, professional, enterprise };
}

async function applyPlanFeatures(tenantId: string, featureKeys: string[]) {
  for (const key of FEATURE_KEYS) {
    await prisma.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey: key } },
      update: { isEnabled: featureKeys.includes(key) },
      create: { tenantId, featureKey: key, isEnabled: featureKeys.includes(key) },
    });
  }
}

async function seedSuperAdmin(roles: Record<string, { id: string }>) {
  const email = (process.env.SUPER_ADMIN_EMAIL ?? 'admin@platform.com').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findFirst({ where: { email, tenantId: null } });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, status: UserStatus.ACTIVE, deletedAt: null },
      })
    : await prisma.user.create({
        data: {
          email,
          tenantId: null,
          passwordHash,
          firstName: 'Platform',
          lastName: 'Owner',
          status: UserStatus.ACTIVE,
        },
      });

  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({
    data: { userId: user.id, roleId: roles.SUPER_ADMIN.id },
  });
}

async function seedDemoTenant(params: {
  name: string;
  slug: string;
  email: string;
  mobile: string;
  adminEmail: string;
  adminPassword: string;
  planId: string;
  featureKeys: string[];
  roles: Record<string, { id: string }>;
}) {
  const trialStart = new Date();
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  const tenant = await prisma.tenant.upsert({
    where: { slug: params.slug },
    update: {},
    create: {
      name: params.name,
      businessName: params.name,
      slug: params.slug,
      email: params.email,
      mobile: params.mobile,
      status: TenantStatus.TRIAL,
      trialStartDate: trialStart,
      trialEndDate: trialEnd,
      gstNumber: params.slug === 'ganpati' ? '27AABCU9603R1ZX' : undefined,
      address: 'Mumbai, India',
    },
  });

  await prisma.tenantSubscription.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planId: params.planId,
      status: SubscriptionStatus.TRIAL,
      billingCycle: BillingCycle.MONTHLY,
      startDate: trialStart,
      endDate: trialEnd,
    },
  });

  await applyPlanFeatures(tenant.id, params.featureKeys);

  const passwordHash = await bcrypt.hash(params.adminPassword, 12);
  const existingAdmin = await prisma.user.findFirst({
    where: { email: params.adminEmail, tenantId: tenant.id },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { passwordHash, status: UserStatus.ACTIVE, deletedAt: null },
      })
    : await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: params.adminEmail,
          passwordHash,
          firstName: 'Company',
          lastName: 'Admin',
          mobile: params.mobile,
          status: UserStatus.ACTIVE,
        },
      });

  await prisma.userRole.deleteMany({ where: { userId: admin.id } });
  await prisma.userRole.create({
    data: { userId: admin.id, roleId: params.roles.COMPANY_ADMIN.id },
  });

  const warehouse =
    (await prisma.warehouse.findFirst({ where: { tenantId: tenant.id, code: 'MAIN' } })) ??
    (await prisma.warehouse.create({
      data: { tenantId: tenant.id, name: 'Main Warehouse', code: 'MAIN', isDefault: true },
    }));

  return { tenant, warehouse };
}

async function seedGanpatiCatalog(tenantId: string, warehouseId: string, createdById: string) {
  const saree =
    (await prisma.category.findFirst({ where: { tenantId, slug: 'saree' } })) ??
    (await prisma.category.create({
      data: { tenantId, name: 'Saree', slug: 'saree' },
    }));
  const banarasi =
    (await prisma.category.findFirst({ where: { tenantId, slug: 'banarasi-saree' } })) ??
    (await prisma.category.create({
      data: { tenantId, name: 'Banarasi Saree', slug: 'banarasi-saree', parentId: saree.id },
    }));
  const brand =
    (await prisma.brand.findFirst({ where: { tenantId, slug: 'banarasi-house' } })) ??
    (await prisma.brand.create({
      data: { tenantId, name: 'Banarasi House', slug: 'banarasi-house' },
    }));

  let product = await prisma.product.findFirst({ where: { tenantId, sku: 'BAN-SILK-001' } });
  if (!product) {
    product = await prisma.product.create({
      data: {
        tenantId,
        name: 'Banarasi Silk Saree',
        productCode: 'BAN-001',
        sku: 'BAN-SILK-001',
        categoryId: banarasi.id,
        brandId: brand.id,
        description: 'Handwoven Banarasi silk saree with zari work.',
        purchasePrice: 1800,
        sellingPrice: 2500,
        mrp: 3200,
        gstRate: 5,
        hsnCode: '5007',
        attributes: { fabric: 'Silk', work: 'Zari', occasion: 'Wedding' },
        media: {
          create: {
            tenantId,
            url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80',
            isPrimary: true,
          },
        },
        variants: {
          create: [
            {
              tenantId,
              sku: 'BAN-SILK-001-RED',
              color: 'Red',
              size: 'Free',
              purchasePrice: 1800,
              sellingPrice: 2500,
              mrp: 3200,
              minimumStockLevel: 5,
              isDefault: true,
            },
            {
              tenantId,
              sku: 'BAN-SILK-001-BLUE',
              color: 'Blue',
              size: 'Free',
              purchasePrice: 1800,
              sellingPrice: 2500,
              mrp: 3200,
              minimumStockLevel: 5,
            },
          ],
        },
      },
    });
  }

  const variants = await prisma.productVariant.findMany({ where: { tenantId, productId: product.id } });
  for (const variant of variants) {
    const qty = variant.color === 'Red' ? 40 : 20;
    const existing = await prisma.stockBalance.findUnique({
      where: {
        tenantId_variantId_warehouseId: { tenantId, variantId: variant.id, warehouseId },
      },
    });
    if (existing) continue;
    await prisma.stockBalance.create({
      data: {
        tenantId,
        productId: product.id,
        variantId: variant.id,
        warehouseId,
        physicalQty: qty,
      },
    });
    await prisma.inventoryTransaction.create({
      data: {
        tenantId,
        productId: product.id,
        variantId: variant.id,
        warehouseId,
        transactionType: InventoryTxnType.OPENING_STOCK,
        quantity: qty,
        physicalDelta: qty,
        reservedDelta: 0,
        notes: 'Seed opening stock',
        createdById,
      },
    });
  }

  const priya = await prisma.customer.findFirst({ where: { tenantId, mobile: '9000000001' } });
  if (!priya) {
    await prisma.customer.create({
      data: {
        tenantId,
        name: 'Priya Sharma',
        mobile: '9000000001',
        whatsappNumber: '9000000001',
        email: 'priya@example.com',
        gender: 'FEMALE',
        addresses: {
          create: {
            tenantId,
            label: 'HOME',
            line1: '12 MG Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
            isDefault: true,
          },
        },
      },
    });
  }

  await seedGanpatiSampleOrder(tenantId, warehouseId, createdById);
  await seedGanpatiCommerce(tenantId, warehouseId);
}

async function seedGanpatiSampleOrder(tenantId: string, warehouseId: string, createdById: string) {
  const existing = await prisma.order.findFirst({ where: { tenantId, orderNumber: 'GA1001' } });
  if (existing) return;

  const customer = await prisma.customer.findFirst({ where: { tenantId, mobile: '9000000001' } });
  const variant = await prisma.productVariant.findFirst({
    where: { tenantId, sku: 'BAN-SILK-001-RED' },
    include: { product: true },
  });
  const address = customer
    ? await prisma.customerAddress.findFirst({ where: { tenantId, customerId: customer.id, isDefault: true } })
    : null;
  if (!customer || !variant) return;

  const quantity = 1;
  const unitPrice = Number(variant.sellingPrice);
  const taxRate = Number(variant.product.gstRate);
  const subtotal = unitPrice * quantity;
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = subtotal + tax;

  const order = await prisma.order.create({
    data: {
      tenantId,
      orderNumber: 'GA1001',
      source: OrderSource.WHATSAPP,
      customerId: customer.id,
      warehouseId,
      status: OrderStatus.CONFIRMED,
      stockState: StockCommitment.COMMITTED,
      subtotal,
      taxAmount: tax,
      totalAmount: total,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.CASH,
      notes: 'Seed WhatsApp / manual sample order',
      shippingAddress: address
        ? {
            name: customer.name,
            phone: customer.mobile,
            line1: address.line1,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
            country: address.country,
          }
        : undefined,
      createdById,
      items: {
        create: {
          tenantId,
          productId: variant.productId,
          variantId: variant.id,
          sku: variant.sku,
          productName: variant.product.name,
          variantLabel: [variant.color, variant.size].filter(Boolean).join(' / ') || null,
          quantity,
          unitPrice,
          taxRate,
          tax,
          total,
        },
      },
      payments: {
        create: {
          tenantId,
          provider: PaymentProviderKind.MOCK,
          providerPaymentId: 'mock_seed_GA1001',
          amount: total,
          status: PaymentStatus.PAID,
          method: PaymentMethod.CASH,
          idempotencyKey: 'seed-ganpati-GA1001',
        },
      },
    },
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      totalOrders: { increment: 1 },
      totalPurchase: { increment: total },
      lastOrderDate: new Date(),
    },
  });

  await prisma.stockBalance.update({
    where: {
      tenantId_variantId_warehouseId: { tenantId, variantId: variant.id, warehouseId },
    },
    data: { physicalQty: { decrement: quantity } },
  });

  await prisma.inventoryTransaction.createMany({
    data: [
      {
        tenantId,
        productId: variant.productId,
        variantId: variant.id,
        warehouseId,
        transactionType: InventoryTxnType.RESERVATION,
        quantity,
        physicalDelta: 0,
        reservedDelta: quantity,
        referenceType: 'order',
        referenceId: order.id,
        notes: `Reserve ${order.orderNumber}`,
        createdById,
      },
      {
        tenantId,
        productId: variant.productId,
        variantId: variant.id,
        warehouseId,
        transactionType: InventoryTxnType.RESERVATION_RELEASE,
        quantity,
        physicalDelta: 0,
        reservedDelta: -quantity,
        referenceType: 'order',
        referenceId: order.id,
        notes: `Commit ${order.orderNumber}`,
        createdById,
      },
      {
        tenantId,
        productId: variant.productId,
        variantId: variant.id,
        warehouseId,
        transactionType: InventoryTxnType.SALE,
        quantity,
        physicalDelta: -quantity,
        reservedDelta: 0,
        referenceType: 'order',
        referenceId: order.id,
        notes: `Sale ${order.orderNumber}`,
        createdById,
      },
    ],
  });
}

async function seedGanpatiCommerce(tenantId: string, warehouseId: string) {
  const extra = [
    {
      name: 'Kanjivaram Bridal Saree',
      sku: 'KAN-SILK-002',
      code: 'KAN-002',
      price: 4200,
      mrp: 5600,
      cost: 2800,
      color: 'Gold',
      qty: 18,
      image: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=900&q=80',
      description: 'Heavy Kanjivaram silk with temple border and gold zari.',
    },
    {
      name: 'Handloom Cotton Saree',
      sku: 'COT-HL-003',
      code: 'COT-003',
      price: 1290,
      mrp: 1690,
      cost: 720,
      color: 'Ivory',
      qty: 30,
      image: 'https://images.unsplash.com/photo-1594633313593-bab3825d0caf?auto=format&fit=crop&w=900&q=80',
      description: 'Everyday handloom cotton with contrast blouse piece.',
    },
    {
      name: 'Designer Georgette Saree',
      sku: 'GEO-DS-004',
      code: 'GEO-004',
      price: 1890,
      mrp: 2490,
      cost: 980,
      color: 'Wine',
      qty: 22,
      image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=900&q=80',
      description: 'Lightweight georgette with sequin work for evening wear.',
    },
  ];

  const saree = await prisma.category.findFirst({ where: { tenantId, slug: 'saree' } });
  for (const item of extra) {
    let product = await prisma.product.findFirst({ where: { tenantId, sku: item.sku } });
    if (!product) {
      product = await prisma.product.create({
        data: {
          tenantId,
          name: item.name,
          productCode: item.code,
          sku: item.sku,
          categoryId: saree?.id,
          description: item.description,
          purchasePrice: item.cost,
          sellingPrice: item.price,
          mrp: item.mrp,
          gstRate: 5,
          attributes: { fabric: item.name.includes('Cotton') ? 'Cotton' : 'Silk' },
          media: { create: { tenantId, url: item.image, isPrimary: true } },
          variants: {
            create: {
              tenantId,
              sku: `${item.sku}-${item.color.slice(0, 3).toUpperCase()}`,
              color: item.color,
              size: 'Free',
              purchasePrice: item.cost,
              sellingPrice: item.price,
              mrp: item.mrp,
              minimumStockLevel: 4,
              isDefault: true,
            },
          },
        },
      });
    }
    const variant = await prisma.productVariant.findFirst({ where: { tenantId, productId: product.id } });
    if (variant) {
      const existing = await prisma.stockBalance.findUnique({
        where: { tenantId_variantId_warehouseId: { tenantId, variantId: variant.id, warehouseId } },
      });
      if (!existing) {
        await prisma.stockBalance.create({
          data: {
            tenantId,
            productId: product.id,
            variantId: variant.id,
            warehouseId,
            physicalQty: item.qty,
          },
        });
      }
    }
  }

  const banarasi = await prisma.product.findFirst({ where: { tenantId, sku: 'BAN-SILK-001' } });
  if (banarasi) {
    const media = await prisma.productMedia.findFirst({ where: { productId: banarasi.id } });
    if (!media) {
      await prisma.productMedia.create({
        data: {
          tenantId,
          productId: banarasi.id,
          url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80',
          isPrimary: true,
        },
      });
    }
  }

  const priya = await prisma.customer.findFirst({ where: { tenantId, mobile: '9000000001' } });
  if (priya) {
    const passwordHash = await bcrypt.hash('Priya@12345', 12);
    await prisma.customerAccount.upsert({
      where: { customerId: priya.id },
      update: { passwordHash, email: 'priya@example.com', status: UserStatus.ACTIVE },
      create: {
        tenantId,
        customerId: priya.id,
        email: 'priya@example.com',
        passwordHash,
      },
    });
    const blue = await prisma.productVariant.findFirst({ where: { tenantId, sku: 'BAN-SILK-001-BLUE' } });
    if (blue) {
      await prisma.wishlistItem.upsert({
        where: { customerId_variantId: { customerId: priya.id, variantId: blue.id } },
        update: {},
        create: { tenantId, customerId: priya.id, productId: blue.productId, variantId: blue.id },
      });
    }
  }

  const supplier =
    (await prisma.supplier.findFirst({ where: { tenantId, mobile: '9811111111' } })) ??
    (await prisma.supplier.create({
      data: {
        tenantId,
        name: 'Banaras Weaves',
        mobile: '9811111111',
        email: 'weaves@banaras.local',
        address: 'Varanasi',
      },
    }));

  const existingPo = await prisma.purchaseOrder.findFirst({ where: { tenantId, purchaseNumber: 'PO1001' } });
  const red = await prisma.productVariant.findFirst({ where: { tenantId, sku: 'BAN-SILK-001-RED' } });
  if (!existingPo && red) {
    await prisma.purchaseOrder.create({
      data: {
        tenantId,
        purchaseNumber: 'PO1001',
        supplierId: supplier.id,
        warehouseId,
        status: 'DRAFT',
        notes: 'Seed draft purchase',
        subtotal: 18000,
        totalAmount: 18000,
        items: {
          create: {
            tenantId,
            productId: red.productId,
            variantId: red.id,
            quantityOrdered: 10,
            unitCost: 1800,
          },
        },
      },
    });
  }

  await prisma.whatsAppConnection.upsert({
    where: { tenantId },
    update: { phoneNumber: '9876543210', status: WhatsAppConnectionStatus.CONNECTED },
    create: { tenantId, phoneNumber: '9876543210', status: WhatsAppConnectionStatus.CONNECTED },
  });
  const thread =
    (await prisma.whatsAppThread.findFirst({ where: { tenantId, phone: '9000000001' } })) ??
    (await prisma.whatsAppThread.create({
      data: { tenantId, phone: '9000000001', customerId: priya?.id },
    }));
  const hasMsg = await prisma.whatsAppMessage.findFirst({ where: { threadId: thread.id } });
  if (!hasMsg) {
    await prisma.whatsAppMessage.create({
      data: {
        tenantId,
        threadId: thread.id,
        direction: 'INBOUND',
        body: 'Hi, is the Banarasi red saree available in stock?',
      },
    });
  }

  const amazon = await prisma.marketplaceAccount.upsert({
    where: { tenantId_platform: { tenantId, platform: MarketplacePlatform.AMAZON } },
    update: { sellerId: 'GANPATI-AMZ', status: MarketplaceAccountStatus.CONNECTED },
    create: {
      tenantId,
      platform: MarketplacePlatform.AMAZON,
      sellerId: 'GANPATI-AMZ',
      status: MarketplaceAccountStatus.CONNECTED,
    },
  });
  if (red) {
    await prisma.marketplaceListing.upsert({
      where: {
        tenantId_accountId_externalSku: { tenantId, accountId: amazon.id, externalSku: 'AMZ-BAN-RED' },
      },
      update: { variantId: red.id },
      create: { tenantId, accountId: amazon.id, variantId: red.id, externalSku: 'AMZ-BAN-RED' },
    });
  }
}

async function main() {
  const permissionIds = await upsertPermissions();
  const roles = await upsertRoles(permissionIds);
  const plans = await seedPlans();
  await seedSuperAdmin(roles);

  const ganpati = await seedDemoTenant({
    name: 'Ganpati Saree',
    slug: 'ganpati',
    email: 'hello@ganpati.local',
    mobile: '9876543210',
    adminEmail: 'admin@ganpati.local',
    adminPassword: 'Ganpati@12345',
    planId: plans.professional.id,
    featureKeys: plans.professional.featureKeys,
    roles,
  });

  await seedDemoTenant({
    name: 'ABC Saree',
    slug: 'abc',
    email: 'hello@abc.local',
    mobile: '9876543211',
    adminEmail: 'admin@abc.local',
    adminPassword: 'AbcSaree@12345',
    planId: plans.basic.id,
    featureKeys: plans.basic.featureKeys,
    roles,
  });

  const ganpatiAdmin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@ganpati.local', tenantId: ganpati.tenant.id },
  });
  await seedGanpatiCatalog(ganpati.tenant.id, ganpati.warehouse.id, ganpatiAdmin.id);

  // eslint-disable-next-line no-console
  console.log('Seed complete.');
  // eslint-disable-next-line no-console
  console.log('Super Admin: admin@platform.com / Admin@12345');
  // eslint-disable-next-line no-console
  console.log('Ganpati: admin@ganpati.local / Ganpati@12345 (slug: ganpati)');
  // eslint-disable-next-line no-console
  console.log('ABC: admin@abc.local / AbcSaree@12345 (slug: abc)');
  // eslint-disable-next-line no-console
  console.log('Customer store: http://localhost:5174/s/ganpati  priya@example.com / Priya@12345');
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
