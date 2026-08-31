import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { CreateShipmentDto, DecideReturnDto, RequestReturnDto } from './dto/shipping.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { RequireFeature } from '../common/decorators/require-feature.decorator';

@Controller()
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('shipments')
  @RequireFeature('ENABLE_SHIPPING')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.shipping.listShipments(user);
  }

  @Post('shipments')
  @RequireFeature('ENABLE_SHIPPING')
  @RequirePermissions(PERMISSIONS.ORDERS_DISPATCH)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateShipmentDto) {
    return this.shipping.createShipment(user, dto);
  }

  @Post('shipments/:id/transit')
  @RequireFeature('ENABLE_SHIPPING')
  @RequirePermissions(PERMISSIONS.ORDERS_DISPATCH)
  transit(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.shipping.markInTransit(user, id);
  }

  @Post('shipments/:id/deliver')
  @RequireFeature('ENABLE_SHIPPING')
  @RequirePermissions(PERMISSIONS.ORDERS_DISPATCH)
  deliver(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.shipping.markDelivered(user, id);
  }

  @Get('returns')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  returns(@CurrentUser() user: RequestUser) {
    return this.shipping.listReturns(user);
  }

  @Post('returns/:id/approve')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  approve(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: DecideReturnDto) {
    return this.shipping.approveReturn(user, id, dto);
  }

  @Post('returns/:id/reject')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  reject(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.shipping.rejectReturn(user, id);
  }

  @Post('returns/:id/receive')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  receive(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: DecideReturnDto) {
    return this.shipping.receiveReturn(user, id, dto);
  }

  @Post('returns/:id/refund')
  @RequirePermissions(PERMISSIONS.PAYMENTS_WRITE)
  refund(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.shipping.refundReturn(user, id);
  }

  @Post('orders/:id/returns')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  staffRequest(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: RequestReturnDto) {
    return this.shipping.requestReturn(user, id, dto);
  }
}
