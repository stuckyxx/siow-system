import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { changePasswordSchema, loginSchema, type CurrentUser as CurrentUserType } from '@siow/shared';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../../common/auth/auth.guard.js';
import { CurrentUser, Public } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { env } from '../../../config/env.js';
import { AuthService, type IssuedTokens } from './auth.service.js';

function setCookies(res: Response, tokens: IssuedTokens): void {
  const cfg = env();
  const base = { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'strict' as const, domain: cfg.COOKIE_DOMAIN || undefined };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, path: '/', maxAge: tokens.accessTtl * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, path: '/api/auth', maxAge: tokens.refreshTtl * 1000 });
}

function clearCookies(res: Response): void {
  const cfg = env();
  const base = { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'strict' as const, domain: cfg.COOKIE_DOMAIN || undefined };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
}

const meta = (req: Request): { ip: string | null; userAgent: string | null } => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: env().LOGIN_RATE_LIMIT_MAX, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(zod(loginSchema)) body: { email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(body.email, body.password, meta(req));
    setCookies(res, tokens);
    return { ok: true, user: tokens.user };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    if (!token) {
      clearCookies(res);
      return { ok: false };
    }
    try {
      const tokens = await this.auth.refresh(token, meta(req));
      setCookies(res, tokens);
      return { ok: true };
    } catch (err) {
      clearCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE]);
    clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserType): CurrentUserType {
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: CurrentUserType,
    @Body(zod(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    clearCookies(res);
    return { ok: true };
  }
}
