/**
 * Winston Logger Configuration
 * Provides structured logging for the application
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let metaStr = '';

    if (Object.keys(metadata).length > 0 && metadata.stack === undefined) {
        metaStr = ` ${JSON.stringify(metadata)}`;
    }

    if (metadata.stack) {
        metaStr = `\n${metadata.stack}`;
    }

    return `${timestamp} [${level}]: ${message}${metaStr}`;
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    ),
    defaultMeta: { service: 'codeautopsy' },
    transports: [
        // Console transport with colors
        new winston.transports.Console({
            format: combine(
                colorize({ all: true }),
                consoleFormat
            ),
        }),
    ],
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
    logger.add(
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: combine(json()),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    );

    logger.add(
        new winston.transports.File({
            filename: 'logs/combined.log',
            format: combine(json()),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    );
}

// Helper methods for structured logging
logger.startOperation = (operation, data = {}) => {
    logger.info(`Starting: ${operation}`, { operation, ...data });
    return Date.now();
};

logger.endOperation = (operation, startTime, data = {}) => {
    const duration = Date.now() - startTime;
    logger.info(`Completed: ${operation}`, { operation, duration: `${duration}ms`, ...data });
    return duration;
};

logger.failOperation = (operation, startTime, error, data = {}) => {
    const duration = Date.now() - startTime;
    logger.error(`Failed: ${operation}`, {
        operation,
        duration: `${duration}ms`,
        error: error.message,
        stack: error.stack,
        ...data,
    });
    return duration;
};

export default logger;
