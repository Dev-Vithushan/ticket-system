// Runs in every test worker before any app module is imported.
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:5432/ticket_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-only-secret-value-that-is-long-enough-123';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), 'ticket-system-test-storage');
process.env.SLA_MONITOR_ENABLED = 'false';
process.env.SMTP_HOST = '';
process.env.CORS_ORIGINS = 'http://localhost:5173';
