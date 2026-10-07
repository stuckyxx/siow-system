import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { LedgerService } from './ledger.service.js';

@Module({ controllers: [ContractsController], providers: [ContractsService, LedgerService], exports: [ContractsService, LedgerService] })
export class ContractsModule {}
