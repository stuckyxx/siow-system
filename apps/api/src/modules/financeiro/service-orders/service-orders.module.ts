import { Module } from '@nestjs/common';
import { ServiceOrdersController } from './service-orders.controller.js';
import { ServiceOrdersService } from './service-orders.service.js';

@Module({ controllers: [ServiceOrdersController], providers: [ServiceOrdersService], exports: [ServiceOrdersService] })
export class ServiceOrdersModule {}
