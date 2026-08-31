import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PurchaseStatus } from '@prisma/client';
import { PurchasesService } from './purchases.service';
import {
  CreatePurchaseDto,
  CreateSupplierDto,
  ReceivePurchaseDto,
  UpdateSupplierDto,
} from './dto/purchase.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  listSuppliers(@CurrentUser() user: RequestUser, @Query('search') search?: string) {
    return this.purchases.listSuppliers(user, search);
  }

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  createSupplier(@CurrentUser() user: RequestUser, @Body() dto: CreateSupplierDto, @Req() req: Request) {
    return this.purchases.createSupplier(user, dto, req.ip);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  updateSupplier(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: UpdateSupplierDto) {
    return this.purchases.updateSupplier(user, id, dto);
  }

  @Get('purchases')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: PurchaseStatus,
    @Query('page') page?: string,
  ) {
    return this.purchases.listPurchases(user, { status, page: page ? Number(page) : undefined });
  }

  @Get('purchases/:id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.purchases.getPurchase(user, id);
  }

  @Post('purchases')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePurchaseDto, @Req() req: Request) {
    return this.purchases.createPurchase(user, dto, req.ip);
  }

  @Post('purchases/:id/send')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  send(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.purchases.send(user, id);
  }

  @Post('purchases/:id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.purchases.cancel(user, id);
  }

  @Post('purchases/:id/receive')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  receive(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ReceivePurchaseDto,
    @Req() req: Request,
  ) {
    return this.purchases.receive(user, id, dto, req.ip);
  }
}
