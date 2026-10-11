import { config } from './config/env';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor';
import { syncReferenceData } from './services/bootstrap';

async function main() {
  await prisma.$connect();
  await syncReferenceData();
  const app = createApp();
  const server = app.listen(config.PORT, () => logger.info(`API listening on :${config.PORT} (docs at /api/docs)`));
  startSlaMonitor();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopSlaMonitor();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
