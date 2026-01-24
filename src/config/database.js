/**
 * Database Configuration
 * Prisma client singleton for PostgreSQL connection
 */

import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

// Create Prisma client with logging configuration
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
});

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug('Prisma Query', {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });
}

/**
 * Connect to database with retry logic
 */
export async function connectDatabase() {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await prisma.$connect();
      logger.info('✅ Database connected successfully');
      return true;
    } catch (error) {
      retries++;
      logger.error(`Database connection failed (attempt ${retries}/${maxRetries})`, {
        error: error.message,
      });

      if (retries >= maxRetries) {
        throw new Error('Failed to connect to database after maximum retries');
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }
  }
}

/**
 * Graceful shutdown handler
 */
export async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting from database', { error: error.message });
  }
}

export default prisma;
