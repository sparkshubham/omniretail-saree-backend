import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { InventoryService } from './inventory.service';
import { AdjustmentDto, CreateTransferDto, LedgerQueryDto, OpeningStockDto } from './dto/inventory.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

class InventoryQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  lowStock?: boolean;
}

class LedgerListDto extends PaginationDto {
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: InventoryQueryDto) {
    return this.inventory.list(user, query);
  }

  @Get('ledger')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  ledger(@CurrentUser() user: RequestUser, @Query() query: LedgerListDto & LedgerQueryDto) {
    return this.inventory.ledger(user, query);
  }

  @Post('opening')
  @RequirePermissions(PERMISSIONS.INVENTORY_WRITE)
  opening(@CurrentUser() user: RequestUser, @Body() dto: OpeningStockDto, @Req() req: Request) {
    return this.inventory.opening(user, dto, req.ip);
  }

  @Post('adjustment')
  @RequirePermissions(PERMISSIONS.INVENTORY_WRITE)
  adjustment(@CurrentUser() user: RequestUser, @Body() dto: AdjustmentDto, @Req() req: Request) {
    return this.inventory.adjustment(user, dto, req.ip);
  }

  @Post('transfer')
  @RequirePermissions(PERMISSIONS.INVENTORY_WRITE)
  transfer(@CurrentUser() user: RequestUser, @Body() dto: CreateTransferDto, @Req() req: Request) {
    return this.inventory.transfer(user, dto, req.ip);
  }
}
