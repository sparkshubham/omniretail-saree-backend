import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../common/decorators/public.decorator';
import { AllowCustomer } from '../common/decorators/allow-customer.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from './types/jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto, req.ip);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { message: 'Company registered successfully', data: result };
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { message: 'Logged in successfully', data: result };
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken || (req.cookies?.refresh_token as string | undefined);
    const result = await this.auth.refresh(token ?? '');
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { message: 'Token refreshed', data: result };
  }

  @AllowCustomer()
  @Post('logout')
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = dto.refreshToken || (req.cookies?.refresh_token as string | undefined);
    this.clearAuthCookies(res);
    return this.auth.logout(user, token);
  }

  @AllowCustomer()
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user);
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const secure =
      this.config.get<string>('COOKIE_SECURE') === 'true' || process.env.NODE_ENV === 'production';
    const base = {
      httpOnly: true,
      secure,
      sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
    };
    res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }
}
