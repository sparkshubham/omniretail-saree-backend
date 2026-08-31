import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MarketplacePlatform } from '@prisma/client';
import { MarketplacesService } from './marketplaces.service';
import { ConnectAccountDto, ImportMarketplaceOrderDto, MapListingDto } from './dto/marketplace.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { RequireFeature } from '../common/decorators/require-feature.decorator';

@Controller('marketplaces')
export class MarketplacesController {
  constructor(private readonly marketplaces: MarketplacesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.marketplaces.list(user);
  }

  @Post('amazon/connect')
  @RequireFeature('ENABLE_AMAZON')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  connectAmazon(@CurrentUser() user: RequestUser, @Body() dto: ConnectAccountDto) {
    return this.marketplaces.connect(user, { ...dto, platform: MarketplacePlatform.AMAZON });
  }

  @Post('flipkart/connect')
  @RequireFeature('ENABLE_FLIPKART')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  connectFlipkart(@CurrentUser() user: RequestUser, @Body() dto: ConnectAccountDto) {
    return this.marketplaces.connect(user, { ...dto, platform: MarketplacePlatform.FLIPKART });
  }

  @Get(':platform/listings')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  listings(@Param('platform') platform: MarketplacePlatform, @CurrentUser() user: RequestUser) {
    return this.marketplaces.listings(user, platform);
  }

  @Post(':platform/listings')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_WRITE)
  map(
    @Param('platform') platform: MarketplacePlatform,
    @CurrentUser() user: RequestUser,
    @Body() dto: MapListingDto,
  ) {
    return this.marketplaces.mapListing(user, platform, dto);
  }

  @Post('amazon/import')
  @RequireFeature('ENABLE_AMAZON')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  importAmazon(@CurrentUser() user: RequestUser, @Body() dto: Omit<ImportMarketplaceOrderDto, 'platform'>) {
    return this.marketplaces.importOrder(user, { ...dto, platform: MarketplacePlatform.AMAZON });
  }

  @Post('flipkart/import')
  @RequireFeature('ENABLE_FLIPKART')
  @RequirePermissions(PERMISSIONS.ORDERS_WRITE)
  importFlipkart(@CurrentUser() user: RequestUser, @Body() dto: Omit<ImportMarketplaceOrderDto, 'platform'>) {
    return this.marketplaces.importOrder(user, { ...dto, platform: MarketplacePlatform.FLIPKART });
  }
}
