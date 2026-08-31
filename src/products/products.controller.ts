import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateMediaDto, CreateProductDto, CreateVariantDto, UpdateProductDto, UpdateVariantDto } from './dto/product.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

class ProductQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: ProductQueryDto) {
    return this.products.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.products.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductDto, @Req() req: Request) {
    return this.products.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    return this.products.update(user, id, dto, req.ip);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.products.remove(user, id, req.ip);
  }

  @Post(':id/variants')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  addVariant(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: CreateVariantDto) {
    return this.products.addVariant(user, id, dto);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(user, id, variantId, dto);
  }

  @Post(':id/media')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  addMedia(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: CreateMediaDto) {
    return this.products.addMedia(user, id, dto);
  }
}
