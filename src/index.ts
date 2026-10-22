import { app } from './app';
import { env } from './config/env';
import { startDonationReminders } from './jobs/donation-reminder.job';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { logger } from './utils/logger';

const PORT = env.PORT || 3000;

async function bootstrap() {
  try {
    // Check Database connection
    await prisma.$connect();
    logger.info('📡 Database connected successfully');
    const stopReminders = startDonationReminders();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server is running on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down...`);
      stopReminders();

      server.close(async () => {
        await prisma.$disconnect();
        redis.close();
        logger.info('✅ Server closed');
        process.exit(0);
      });

      // Force exit if timeout
      setTimeout(() => {
        logger.error('❌ Force shutdown');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Unhandled errors
    process.on('unhandledRejection', (reason: unknown) => {
      // Safely convert the unknown reason into a proper Error object if it isn't one already
      const error = reason instanceof Error ? reason : new Error(String(reason));
      logger.error(error, 'Unhandled Rejection');
      shutdown('unhandledRejection');
    });

    process.on('uncaughtException', (reason: unknown) => {
      // Safely convert the unknown reason into a proper Error object if it isn't one already
      const error = reason instanceof Error ? reason : new Error(String(reason));
      logger.error(error, 'Uncaught Exception');
      shutdown('uncaughtException');
    });
  } catch (error) {
    logger.error(error, '❌ Failed to connect to the database:');
    process.exit(1);
  }
}

bootstrap();
