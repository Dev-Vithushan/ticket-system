import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: bool.default(false),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: bool.default(false),
  COOKIE_DOMAIN: z.string().optional().transform((v) => (v ? v : undefined)),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/attachments'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  SMTP_HOST: z.string().optional().transform((v) => (v ? v : undefined)),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('Support Desk <support@example.com>'),
  APP_URL: z.string().default('http://localhost:5173'),
  SLA_MONITOR_ENABLED: bool.default(true),
  SLA_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  const insecure = [env.JWT_ACCESS_SECRET].some((s) => /change-me|dev-only|secret/i.test(s));
  if (insecure) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start: JWT_ACCESS_SECRET looks like a development placeholder.');
    process.exit(1);
  }
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    console.error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    process.exit(1);
  }
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  cookieSecure: env.NODE_ENV === 'production' ? true : env.COOKIE_SECURE,
  maxUploadBytes: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
};
export type AppConfig = typeof config;
