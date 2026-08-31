import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [AuthModule, OrdersModule, ShippingModule],
  controllers: [StoreController],
  providers: [StoreService],
})
export class StoreModule {}
