import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, output } from 'zod';

/** Pipe de validação com Zod — reutiliza os schemas de @siow/shared no backend e no frontend. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, output<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): output<S> {
    return this.schema.parse(value);
  }
}

export const zod = <S extends ZodTypeAny>(schema: S): ZodPipe<S> => new ZodPipe(schema);
