import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import {
  CollectPaymentDto,
  CreateOrderDto,
  OrderQueryDto,
  PaymentWebhookDto,
  UpdateOrderStatusDto,
  VerifyPaymentDto,
} from './dto/order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: OrderQueryDto) {
    return this.orders.list(user, query);
  }

  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.orders.get(user, id);
  }

  @Post('orders')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOrderDto, @Req() req: Request) {
    return this.orders.create(user, dto, req.ip);
  }

  @Patch('orders/:id/status')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: Request,
  ) {
    return this.orders.updateStatus(user, id, dto, req.ip);
  }

  @Post('orders/:id/pay')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  pay(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CollectPaymentDto,
    @Req() req: Request,
  ) {
    return this.orders.collectPayment(user, id, dto, req.ip);
  }

  @Post('orders/:id/payments')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  checkout(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.orders.createCheckout(user, id);
  }

  @Post('orders/:id/payments/verify')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  verify(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: VerifyPaymentDto,
    @Req() req: Request,
  ) {
    return this.orders.verifyPayment(user, id, dto, req.ip);
  }

  @Public()
  @Post('webhooks/payment')
  webhook(@Body() dto: PaymentWebhookDto) {
    return this.orders.handleWebhook(dto);
  }
}
