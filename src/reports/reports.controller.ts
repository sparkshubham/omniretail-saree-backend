import { Controller, Get } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  sales(@CurrentUser() user: RequestUser) {
    return this.reports.sales(user);
  }

  @Get('inventory')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  inventory(@CurrentUser() user: RequestUser) {
    return this.reports.inventory(user);
  }

  @Get('products')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  products(@CurrentUser() user: RequestUser) {
    return this.reports.products(user);
  }

  @Get('customers')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  customers(@CurrentUser() user: RequestUser) {
    return this.reports.customers(user);
  }

  @Get('gst')
  @RequirePermissions(PERMISSIONS.REPORTS_GST)
  gst(@CurrentUser() user: RequestUser) {
    return this.reports.gst(user);
  }
}
