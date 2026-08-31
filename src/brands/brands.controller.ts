import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.brands.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBrandDto) {
    return this.brands.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  update(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: UpdateBrandDto) {
    return this.brands.update(user, id, dto);
  }
}
