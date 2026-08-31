import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: PaginationDto) {
    return this.users.list(user, query);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  roles() {
    return this.users.roles();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateStaffDto, @Req() req: Request) {
    return this.users.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateStaffDto,
    @Req() req: Request,
  ) {
    return this.users.update(user, id, dto, req.ip);
  }
}
