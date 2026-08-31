import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { FeaturesModule } from './features/features.module';
import { AuditModule } from './audit/audit.module';
import { PlatformModule } from './platform/platform.module';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { ProductsModule } from './products/products.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { PurchasesModule } from './purchases/purchases.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { MarketplacesModule } from './marketplaces/marketplaces.module';
import { ShippingModule } from './shipping/shipping.module';
import { ReportsModule } from './reports/reports.module';
import { StoreModule } from './store/store.module';
import { HealthController } from './health/health.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { SettingsController } from './settings/settings.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { FeatureGuard } from './common/guards/feature.guard';
import { StaffGuard } from './common/guards/staff.guard';
import { CustomerGuard } from './common/guards/customer.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => [{ ttl: 60_000, limit: 120 }],
    }),
    PrismaModule,
    AuditModule,
    FeaturesModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    SubscriptionsModule,
    PlatformModule,
    CategoriesModule,
    BrandsModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    CustomersModule,
    PaymentsModule,
    OrdersModule,
    PurchasesModule,
    WhatsAppModule,
    MarketplacesModule,
    ShippingModule,
    ReportsModule,
    StoreModule,
  ],
  controllers: [HealthController, DashboardController, SettingsController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: StaffGuard },
    { provide: APP_GUARD, useClass: CustomerGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
