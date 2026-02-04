
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { validateToken } from './config/github.js';
import webhookRouter from './webhooks/github-listener.js';
import { fixQueue, closeQueue } from './queue/fix-queue.js';
import { sendStartupNotification, sendShutdownNotification } from './notifications/discord.js';
import logger from './utils/logger.js';

// Handle BigInt serialization for JSON responses
BigInt.prototype.toJSON = function () {
    return Number(this);
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false,
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    },
}));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`${req.method} ${req.path}`, {
            status: res.statusCode,
            duration: `${duration}ms`,
        });
    });
    next();
});

// ================================
// Routes
// ================================

// Health check
app.get('/', (req, res) => {
    res.json({
        name: 'CodeAutopsy',
        version: '1.0.0',
        description: 'AI-Powered CI/CD Failure Auto-Fix Agent',
        status: 'running',
        endpoints: {
            webhooks: '/webhooks/github',
            health: '/webhooks/health',
            status: '/webhooks/status',
            queue: '/api/queue',
        },
    });
});

// Webhook routes
app.use('/webhooks', webhookRouter);

// Queue status API
app.get('/api/queue', async (req, res) => {
    try {
        const [counts, active, waiting, failed] = await Promise.all([
            fixQueue.getJobCounts(),
            fixQueue.getActive(),
            fixQueue.getWaiting(),
            fixQueue.getFailed(),
        ]);

        res.json({
            counts,
            active: active.length,
            waiting: waiting.length,
            failed: failed.length,
            recentFailed: failed.slice(0, 5).map(job => ({
                id: job.id,
                data: job.data,
                failedReason: job.failedReason,
                attemptsMade: job.attemptsMade,
            })),
        });
    } catch (error) {
        logger.error('Queue status error', { error: error.message });
        res.status(500).json({ error: 'Failed to get queue status' });
    }
});

// Retry failed jobs
app.post('/api/queue/retry-failed', async (req, res) => {
    try {
        const failed = await fixQueue.getFailed();
        const retried = [];

        for (const job of failed) {
            await job.retry();
            retried.push(job.id);
        }

        res.json({
            message: `Retried ${retried.length} failed jobs`,
            jobIds: retried,
        });
    } catch (error) {
        logger.error('Retry failed error', { error: error.message });
        res.status(500).json({ error: 'Failed to retry jobs' });
    }
});

// Clear completed jobs
app.post('/api/queue/clean', async (req, res) => {
    try {
        await fixQueue.clean(24 * 60 * 60 * 1000, 'completed'); // 24 hours
        await fixQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // 7 days
        res.json({ message: 'Queue cleaned' });
    } catch (error) {
        logger.error('Queue clean error', { error: error.message });
        res.status(500).json({ error: 'Failed to clean queue' });
    }
});

// ================================
// Dashboard API Endpoints
// ================================

// Get all failure events with pagination
app.get('/api/events', async (req, res) => {
    try {
        const { page = 1, limit = 10, status, repo } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};
        if (status) where.status = status;
        if (repo) where.repoFullName = { contains: repo };

        const { default: prisma } = await import('./config/database.js');

        const [events, total] = await Promise.all([
            prisma.failureEvent.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
                include: {
                    fixAttempts: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            }),
            prisma.failureEvent.count({ where }),
        ]);

        res.json({
            events,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        logger.error('Get events error', { error: error.message });
        res.status(500).json({ error: 'Failed to get events' });
    }
});

// Get single event with all details
app.get('/api/events/:id', async (req, res) => {
    try {
        const { default: prisma } = await import('./config/database.js');

        const event = await prisma.failureEvent.findUnique({
            where: { id: req.params.id },
            include: {
                fixAttempts: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        res.json(event);
    } catch (error) {
        logger.error('Get event error', { error: error.message });
        res.status(500).json({ error: 'Failed to get event' });
    }
});

// Get dashboard stats
app.get('/api/stats', async (req, res) => {
    try {
        const { default: prisma } = await import('./config/database.js');

        const [
            totalEvents,
            fixedEvents,
            failedEvents,
            pendingEvents,
            recentEvents,
            topRepos,
        ] = await Promise.all([
            prisma.failureEvent.count(),
            prisma.failureEvent.count({ where: { status: 'FIXED' } }),
            prisma.failureEvent.count({ where: { status: 'FAILED' } }),
            prisma.failureEvent.count({ where: { status: { in: ['DETECTED', 'ANALYZING', 'FIXING'] } } }),
            prisma.failureEvent.findMany({
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    repoFullName: true,
                    status: true,
                    errorType: true,
                    createdAt: true,
                },
            }),
            prisma.failureEvent.groupBy({
                by: ['repoFullName'],
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take: 5,
            }),
        ]);

        const successRate = totalEvents > 0
            ? Math.round((fixedEvents / totalEvents) * 100)
            : 0;

        res.json({
            totalEvents,
            fixedEvents,
            failedEvents,
            pendingEvents,
            successRate,
            recentEvents,
            topRepos: topRepos.map(r => ({
                repo: r.repoFullName,
                count: r._count.id,
            })),
        });
    } catch (error) {
        logger.error('Get stats error', { error: error.message });
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Get fix attempts
app.get('/api/fixes', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const { default: prisma } = await import('./config/database.js');

        const [fixes, total] = await Promise.all([
            prisma.fixAttempt.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
                include: {
                    failureEvent: {
                        select: {
                            repoFullName: true,
                            branch: true,
                            errorType: true,
                        },
                    },
                },
            }),
            prisma.fixAttempt.count(),
        ]);

        res.json({
            fixes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        logger.error('Get fixes error', { error: error.message });
        res.status(500).json({ error: 'Failed to get fixes' });
    }
});

// Get notifications
app.get('/api/notifications', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const { default: prisma } = await import('./config/database.js');

        const [notifications, total] = await Promise.all([
            prisma.notification.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.notification.count(),
        ]);

        res.json({
            notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        logger.error('Get notifications error', { error: error.message });
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Manual trigger endpoint (for testing)
app.post('/api/trigger', async (req, res) => {
    const { owner, repo, commitSha, runId, logsUrl, branch } = req.body;

    if (!owner || !repo || !commitSha) {
        return res.status(400).json({
            error: 'Missing required fields: owner, repo, commitSha',
        });
    }

    try {
        const { default: prisma } = await import('./config/database.js');

        // Create failure event
        const failureEvent = await prisma.failureEvent.create({
            data: {
                repoFullName: `${owner}/${repo}`,
                repoOwner: owner,
                repoName: repo,
                commitSha,
                runId: runId || 0,
                branch: branch || 'main',
                logsUrl: logsUrl || '',
                status: 'DETECTED',
            },
        });

        // Add to queue
        const job = await fixQueue.add('process-failure', {
            eventId: failureEvent.id,
            owner,
            repo,
            commitSha,
            runId: runId || 0,
            branch: branch || 'main',
            logsUrl: logsUrl || '',
            manual: true,
        });

        res.status(202).json({
            message: 'Manual trigger queued',
            eventId: failureEvent.id,
            jobId: job.id,
        });
    } catch (error) {
        logger.error('Manual trigger error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path,
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
    });

    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// ================================
// Startup
// ================================

async function start() {
    logger.info('Starting CodeAutopsy...');

    try {
        // Validate environment
        const requiredEnvVars = ['GITHUB_TOKEN', 'GEMINI_API_KEY'];
        const missing = requiredEnvVars.filter(v => !process.env[v]);

        if (missing.length > 0) {
            logger.error(`Missing required environment variables: ${missing.join(', ')}`);
            process.exit(1);
        }

        // Connect to database
        await connectDatabase();
        logger.info('Database connected');

        // Validate GitHub token
        const tokenValidation = await validateToken();
        if (!tokenValidation.valid) {
            logger.error('Invalid GitHub token', { error: tokenValidation.error });
            process.exit(1);
        }
        logger.info(`GitHub authenticated as: ${tokenValidation.user}`);

        // Start server
        const server = app.listen(PORT, () => {
            logger.info(`🚀 CodeAutopsy server running on port ${PORT}`);
            logger.info(`📡 Webhook endpoint: http://localhost:${PORT}/webhooks/github`);
            logger.info(`📊 Status endpoint: http://localhost:${PORT}/webhooks/status`);
        });

        // Send startup notification
        await sendStartupNotification();

        // Graceful shutdown
        const shutdown = async (signal) => {
            logger.info(`${signal} received, shutting down gracefully...`);

            await sendShutdownNotification();

            server.close(async () => {
                logger.info('HTTP server closed');
                await closeQueue();
                await disconnectDatabase();
                logger.info('Shutdown complete');
                process.exit(0);
            });

            // Force exit after 10 seconds
            setTimeout(() => {
                logger.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        logger.error('Failed to start server', {
            error: error.message,
            stack: error.stack,
        });
        process.exit(1);
    }
}

// Start the server
start();

export default app;
