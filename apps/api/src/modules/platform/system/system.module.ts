import { Module } from '@nestjs/common';
import { SystemController } from './system.controller.js';

/** Auditoria (leitura), notificações, configurações e health. */
@Module({ controllers: [SystemController] })
export class SystemModule {}
