import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

class CategoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  tree?: boolean;
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: CategoryQueryDto) {
    return query.tree ? this.categories.tree(user) : this.categories.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCategoryDto, @Req() req: Request) {
    return this.categories.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categories.update(user, id, dto, req.ip);
  }
}
