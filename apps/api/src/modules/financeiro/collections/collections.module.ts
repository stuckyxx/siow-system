import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';

@Module({ imports: [MessagingModule], controllers: [CollectionsController], providers: [CollectionsService], exports: [CollectionsService] })
export class CollectionsModule {}
