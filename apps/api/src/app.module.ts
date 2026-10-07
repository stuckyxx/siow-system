import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './common/audit/audit.module.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { CsrfGuard } from './common/auth/csrf.guard.js';
import { InfraModule } from './common/infra/infra.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { env } from './config/env.js';
import { FinanceiroModule } from './modules/financeiro/financeiro.module.js';
import { AuthModule } from './modules/platform/auth/auth.module.js';
import { DocumentsModule } from './modules/platform/documents/documents.module.js';
import { SystemModule } from './modules/platform/system/system.module.js';
import { UsersModule } from './modules/platform/users/users.module.js';

/**
 * Siow System — API.
 *  - platform/: autenticação, usuários/RBAC, documentos, auditoria, notificações, configurações
 *  - financeiro/: módulo Financeiro (contratos e recebimentos)
 *  - próximos módulos entram como irmãos de `financeiro/`, reutilizando a plataforma.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: env().RATE_LIMIT_TTL_SECONDS * 1000, limit: env().RATE_LIMIT_MAX }]),
    PrismaModule,
    AuditModule,
    InfraModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    SystemModule,
    FinanceiroModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
