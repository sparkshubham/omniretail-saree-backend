import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import {
  ConnectWhatsAppDto,
  CreateWhatsAppOrderDto,
  SendMessageDto,
  SimulateInboundDto,
} from './dto/whatsapp.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { RequireFeature } from '../common/decorators/require-feature.decorator';

@Controller('whatsapp')
@RequireFeature('ENABLE_WHATSAPP')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  status(@CurrentUser() user: RequestUser) {
    return this.whatsapp.status(user);
  }

  @Post('connect')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  connect(@CurrentUser() user: RequestUser, @Body() dto: ConnectWhatsAppDto) {
    return this.whatsapp.connect(user, dto);
  }

  @Post('disconnect')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  disconnect(@CurrentUser() user: RequestUser) {
    return this.whatsapp.disconnect(user);
  }

  @Get('threads')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  threads(@CurrentUser() user: RequestUser) {
    return this.whatsapp.threads(user);
  }

  @Get('threads/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  thread(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.whatsapp.thread(user, id);
  }

  @Post('simulate')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  simulate(@CurrentUser() user: RequestUser, @Body() dto: SimulateInboundDto) {
    return this.whatsapp.simulateInbound(user, dto);
  }

  @Post('threads/:id/messages')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  send(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: SendMessageDto) {
    return this.whatsapp.send(user, id, dto);
  }

  @Post('threads/:id/orders')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  createOrder(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: CreateWhatsAppOrderDto) {
    return this.whatsapp.createOrder(user, id, dto);
  }
}
