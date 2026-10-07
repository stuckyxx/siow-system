import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({ imports: [CertificatesModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
