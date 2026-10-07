import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Pipe de validação com Zod — reutiliza os schemas de @siow/shared no backend e no frontend. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}

export const zod = <T>(schema: ZodType<T>): ZodPipe<T> => new ZodPipe(schema);
