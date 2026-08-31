import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PlansController } from './plans.controller';

@Module({
  controllers: [PlansController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
