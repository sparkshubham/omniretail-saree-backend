import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSES_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.warehouses.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSES_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateWarehouseDto, @Req() req: Request) {
    return this.warehouses.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.WAREHOUSES_WRITE)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateWarehouseDto,
    @Req() req: Request,
  ) {
    return this.warehouses.update(user, id, dto, req.ip);
  }
}
