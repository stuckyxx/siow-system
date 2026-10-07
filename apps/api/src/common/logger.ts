import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash', '*.token', '*.refreshToken'],
    censor: '[redacted]',
  },
  base: { service: 'siow-api' },
});
