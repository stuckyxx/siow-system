import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword } from '@siow/db';
import { AuditService } from '../../../common/audit/audit.service.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { env, ttlToSeconds } from '../../../config/env.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTtl: number;
  refreshTtl: number;
  sessionId: string;
  user: { id: string; name: string; email: string; mustChangePassword: boolean };
}

const hash = (v: string): string => createHash('sha256').update(v).digest('hex');

/**
 * Autenticação com senha Argon2id, access token JWT curto e refresh token
 * opaco rotativo (apenas o hash fica no banco). Reuso de um refresh já
 * rotacionado revoga toda a cadeia (detecção de roubo).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, meta: { ip: string | null; userAgent: string | null }): Promise<IssuedTokens> {
    const user = await this.prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
    // Sempre executa a verificação (mesmo custo) para não revelar existência do e-mail
    const ok = await verifyPassword(user?.passwordHash, password).catch(() => false);
    if (!user || !ok || !user.isActive) {
      await this.audit.log(null, { action: 'LOGIN_FAILED', resource: 'auth', after: { email: email.toLowerCase(), ip: meta.ip } });
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const tokens = await this.issueSession(user.id, meta, { id: user.id, name: user.name, email: user.email, mustChangePassword: user.mustChangePassword });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log(
      { user: { id: user.id, name: user.name, email: user.email, roles: [], permissions: [] }, ip: meta.ip, userAgent: meta.userAgent, requestId: null },
      { action: 'LOGIN', resource: 'auth', resourceId: tokens.sessionId },
    );
    return tokens;
  }

  async refresh(refreshToken: string, meta: { ip: string | null; userAgent: string | null }): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash(refreshToken) }, include: { user: true } });
    if (!session) throw new UnauthorizedException('Sessão inválida');
    if (session.revokedAt) {
      // Token já rotacionado sendo reutilizado → possível roubo: revoga tudo do usuário
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(null, { action: 'REFRESH_REUSE_DETECTED', resource: 'auth', resourceId: session.id, after: { ip: meta.ip } });
      throw new UnauthorizedException('Sessão revogada');
    }
    if (session.expiresAt < new Date() || !session.user.isActive || session.user.deletedAt) {
      throw new UnauthorizedException('Sessão expirada');
    }
    const u = session.user;
    const next = await this.issueSession(session.userId, meta, { id: u.id, name: u.name, email: u.email, mustChangePassword: u.mustChangePassword });
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedById: next.sessionId } });
    return next;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({ where: { refreshTokenHash: hash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new UnauthorizedException('Senha atual incorreta');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
      // troca de senha invalida as demais sessões
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  private async issueSession(userId: string, meta: { ip: string | null; userAgent: string | null }, user: IssuedTokens['user']): Promise<IssuedTokens> {
    const cfg = env();
    const accessTtl = ttlToSeconds(cfg.JWT_ACCESS_TTL);
    const refreshTtl = ttlToSeconds(cfg.JWT_REFRESH_TTL);
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: session.id, type: 'access' },
      { secret: cfg.JWT_ACCESS_SECRET, expiresIn: accessTtl },
    );
    return { accessToken, refreshToken, accessTtl, refreshTtl, sessionId: session.id, user };
  }
}
