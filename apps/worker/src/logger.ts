import pino from 'pino';

/** Logs estruturados sem dados sensíveis (nunca logar tokens, senhas, contatos). */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.password', '*.token', '*.authorization', '*.email', '*.phone', '*.whatsapp'],
  base: { service: 'siow-worker' },
});

export type Logger = typeof logger;
