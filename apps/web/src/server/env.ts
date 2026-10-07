import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  APP_URL: z.string().url().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(2),
  SYNC_BUDGET_MS: z.coerce.number().int().min(5000).max(290000).default(45000),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().optional(), SMTP_USER: z.string().optional(), SMTP_PASS: z.string().optional(), SMTP_FROM: z.string().optional(),
  WHATSAPP_API_URL: z.string().optional(), WHATSAPP_TOKEN: z.string().optional(), WHATSAPP_PHONE_ID: z.string().optional(),
});
export type Env = z.infer<typeof schema>;
let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) throw new Error('Variáveis de ambiente inválidas: ' + r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
    cached = r.data;
  }
  return cached;
}
