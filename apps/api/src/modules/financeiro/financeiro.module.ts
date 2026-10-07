import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ServiceOrdersModule } from './service-orders/service-orders.module.js';
import { SyncModule } from './sync/sync.module.js';
import { TasksModule } from './tasks/tasks.module.js';

/** Módulo Financeiro — gestão de contratos e recebimentos de órgãos públicos. */
@Module({
  imports: [
    EntitiesModule,
    ContractsModule,
    InvoicesModule,
    SyncModule,
    DashboardModule,
    CertificatesModule,
    TasksModule,
    MessagingModule,
    CollectionsModule,
    ServiceOrdersModule,
    ReportsModule,
  ],
})
export class FinanceiroModule {}
