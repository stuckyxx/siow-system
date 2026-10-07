import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

/**
 * Resposta de erro uniforme e sem vazamento de detalhes internos.
 * Erros de validação (Zod) viram 422 com a lista de campos.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof ZodError) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: 422,
        error: 'Dados inválidos',
        issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { statusCode: status, error: body } : body);
      return;
    }

    // Prisma: violação de unicidade / registro não encontrado
    const code = (exception as { code?: string })?.code;
    if (code === 'P2002') {
      res.status(HttpStatus.CONFLICT).json({ statusCode: 409, error: 'Registro duplicado', detail: (exception as { meta?: unknown }).meta });
      return;
    }
    if (code === 'P2025') {
      res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'Registro não encontrado' });
      return;
    }

    logger.error({ err: exception, path: req.url, method: req.method }, 'erro não tratado');
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, error: 'Erro interno' });
  }
}
