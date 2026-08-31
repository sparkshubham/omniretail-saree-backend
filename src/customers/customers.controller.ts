import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsOptional, IsString } from 'class-validator';
import { CustomersService } from './customers.service';
import { CreateAddressDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

class CustomerQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: CustomerQueryDto) {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.customers.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.customers.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    return this.customers.update(user, id, dto, req.ip);
  }

  @Post(':id/addresses')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  addAddress(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() dto: CreateAddressDto) {
    return this.customers.addAddress(user, id, dto);
  }
}
