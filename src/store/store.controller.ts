import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { StoreService } from './store.service';
import {
  CreateAddressDto,
  StoreCartItemDto,
  StoreCartQtyDto,
  StoreCatalogQueryDto,
  StoreCheckoutDto,
  StoreLoginDto,
  StoreRegisterDto,
} from './dto/store.dto';
import { RequestReturnDto } from '../shipping/dto/shipping.dto';
import { VerifyPaymentDto } from '../orders/dto/order.dto';
import { Public } from '../common/decorators/public.decorator';
import { AllowCustomer } from '../common/decorators/allow-customer.decorator';
import { CustomerAccount } from '../common/decorators/customer-account.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/jwt-payload';

@Controller('store/:slug')
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  boutique(@Param('slug') slug: string) {
    return this.store.boutique(slug);
  }

  @Public()
  @Get('categories')
  categories(@Param('slug') slug: string) {
    return this.store.categories(slug);
  }

  @Public()
  @Get('products')
  products(@Param('slug') slug: string, @Query() query: StoreCatalogQueryDto) {
    return this.store.products(slug, query);
  }

  @Public()
  @Get('products/:id')
  product(@Param('slug') slug: string, @Param('id') id: string) {
    return this.store.product(slug, id);
  }

  @Public()
  @Get('track/:awb')
  track(@Param('slug') slug: string, @Param('awb') awb: string) {
    return this.store.track(slug, awb);
  }

  @Public()
  @Post('auth/register')
  async register(
    @Param('slug') slug: string,
    @Body() dto: StoreRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.store.register(slug, dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { message: 'Account created', data: result };
  }

  @Public()
  @Post('auth/login')
  async login(
    @Param('slug') slug: string,
    @Body() dto: StoreLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.store.login(slug, dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { message: 'Signed in', data: result };
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('me')
  me(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.store.me(slug, user);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('cart')
  cart(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.store.cart(slug, user);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('cart')
  addCart(@Param('slug') slug: string, @CurrentUser() user: RequestUser, @Body() dto: StoreCartItemDto) {
    return this.store.addToCart(slug, user, dto);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Patch('cart/:itemId')
  updateCart(
    @Param('slug') slug: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: StoreCartQtyDto,
  ) {
    return this.store.updateCartItem(slug, user, itemId, dto.quantity);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Delete('cart/:itemId')
  removeCart(@Param('slug') slug: string, @Param('itemId') itemId: string, @CurrentUser() user: RequestUser) {
    return this.store.removeCartItem(slug, user, itemId);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('wishlist')
  wishlist(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.store.wishlist(slug, user);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('wishlist')
  addWishlist(@Param('slug') slug: string, @CurrentUser() user: RequestUser, @Body() dto: StoreCartItemDto) {
    return this.store.addWishlist(slug, user, dto.variantId);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Delete('wishlist/:variantId')
  removeWishlist(
    @Param('slug') slug: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.store.removeWishlist(slug, user, variantId);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('addresses')
  addresses(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.store.addresses(slug, user);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('addresses')
  addAddress(@Param('slug') slug: string, @CurrentUser() user: RequestUser, @Body() dto: CreateAddressDto) {
    return this.store.addAddress(slug, user, dto);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('checkout')
  checkout(@Param('slug') slug: string, @CurrentUser() user: RequestUser, @Body() dto: StoreCheckoutDto) {
    return this.store.checkout(slug, user, dto);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('orders')
  orders(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.store.myOrders(slug, user);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Get('orders/:id')
  order(@Param('slug') slug: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.store.myOrder(slug, user, id);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('orders/:id/pay')
  pay(@Param('slug') slug: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.store.pay(slug, user, id);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('orders/:id/verify')
  verify(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.store.verify(slug, user, id, dto);
  }

  @AllowCustomer()
  @CustomerAccount()
  @Post('orders/:id/returns')
  requestReturn(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RequestReturnDto,
  ) {
    return this.store.requestReturn(slug, user, id, dto);
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const secure = this.config.get<string>('COOKIE_SECURE') === 'true';
    const base = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
    res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
}
