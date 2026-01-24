/**
 * GitHub Webhook Listener
 * Handles incoming GitHub webhook events for CI/CD failures
 */

import crypto from 'crypto';
import { Router } from 'express';
import prisma from '../config/database.js';
import { fixQueue } from '../queue/fix-queue.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Verify GitHub webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - X-Hub-Signature-256 header
 * @returns {boolean} Whether signature is valid
 */
function verifySignature(payload, signature) {
    if (!process.env.GITHUB_WEBHOOK_SECRET) {
        logger.warn('GITHUB_WEBHOOK_SECRET not set, skipping signature verification');
        return true;
    }

    if (!signature) {
        logger.warn('No signature provided in webhook request');
        return false;
    }

    // GitHub sends signature as "sha256=<hash>"
    const expectedSignature = signature.startsWith('sha256=') 
        ? signature.substring(7) 
        : signature;

    // Calculate HMAC
    const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
    hmac.update(payload);
    const calculatedHash = hmac.digest('hex');

    // Use timing-safe comparison
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

    if (expectedBuffer.length !== calculatedBuffer.length) {
        logger.warn('Invalid webhook signature: length mismatch');
        return false;
    }

    if (!crypto.timingSafeEqual(expectedBuffer, calculatedBuffer)) {
        logger.warn('Invalid webhook signature: hash mismatch');
        return false;
    }

    return true;
}

/**
 * Check rate limits for repository
 * @param {string} repoFullName - Full repository name (owner/repo)
 * @returns {Promise<{allowed: boolean, remaining: number}>}
 */
async function checkRateLimit(repoFullName) {
    const maxAttempts = parseInt(process.env.MAX_FIX_ATTEMPTS_PER_HOUR) || 5;
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
        let rateLimit = await prisma.rateLimit.findUnique({
            where: { repoFullName },
        });

        if (!rateLimit) {
            // Create new rate limit entry
            rateLimit = await prisma.rateLimit.create({
                data: {
                    repoFullName,
                    attemptsThisHour: 0,
                    hourlyResetAt: new Date(now.getTime() + 60 * 60 * 1000),
                },
            });
        }

        // Check if blacklisted
        if (rateLimit.isBlacklisted) {
            return { allowed: false, remaining: 0, reason: 'Repository is blacklisted' };
        }

        // Reset counter if hour has passed
        if (rateLimit.hourlyResetAt < now) {
            rateLimit = await prisma.rateLimit.update({
                where: { repoFullName },
                data: {
                    attemptsThisHour: 0,
                    hourlyResetAt: new Date(now.getTime() + 60 * 60 * 1000),
                },
            });
        }

        const remaining = maxAttempts - rateLimit.attemptsThisHour;
        const allowed = remaining > 0;

        return { allowed, remaining, reason: allowed ? null : 'Rate limit exceeded' };
    } catch (error) {
        logger.error('Rate limit check failed', { error: error.message });
        // Allow on error to not block legitimate requests
        return { allowed: true, remaining: 1, reason: null };
    }
}

/**
 * Increment rate limit counter
 * @param {string} repoFullName - Full repository name
 */
async function incrementRateLimit(repoFullName) {
    try {
        await prisma.rateLimit.update({
            where: { repoFullName },
            data: {
                attemptsThisHour: { increment: 1 },
                lastAttemptAt: new Date(),
            },
        });
    } catch (error) {
        logger.error('Failed to increment rate limit', { error: error.message });
    }
}

/**
 * Check if path is protected
 * @param {string} path - File path to check
 * @returns {boolean} Whether path is protected
 */
function isProtectedPath(path) {
    const protectedPaths = (process.env.PROTECTED_PATHS || 'config,secrets,.github/workflows,.env')
        .split(',')
        .map(p => p.trim().toLowerCase());

    const lowerPath = path.toLowerCase();
    return protectedPaths.some(protectedPath => lowerPath.includes(protectedPath));
}

/**
 * Main webhook handler for GitHub events
 */
router.post('/github', async (req, res) => {
    const startTime = Date.now();
    const eventType = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];
    const signature = req.headers['x-hub-signature-256'];

    logger.info('Received GitHub webhook', { eventType, deliveryId });

    // Verify signature
    if (!verifySignature(req.rawBody || JSON.stringify(req.body), signature)) {
        logger.warn('Invalid webhook signature', { deliveryId });
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;

    // Handle workflow_job events
    if (eventType === 'workflow_job') {
        return handleWorkflowJob(payload, deliveryId, res);
    }

    // Handle workflow_run events (alternative)
    if (eventType === 'workflow_run') {
        return handleWorkflowRun(payload, deliveryId, res);
    }

    // Handle check_run events
    if (eventType === 'check_run') {
        return handleCheckRun(payload, deliveryId, res);
    }

    // Acknowledge other events
    logger.debug('Ignoring event type', { eventType });
    res.status(200).json({ message: 'Event ignored', eventType });
});

/**
 * Handle workflow_job events
 */
async function handleWorkflowJob(payload, deliveryId, res) {
    const job = payload.workflow_job;
    const repo = payload.repository;

    // Only process failed jobs
    if (job.conclusion !== 'failure') {
        logger.debug('Ignoring non-failure job', {
            conclusion: job.conclusion,
            jobName: job.name,
        });
        return res.status(200).json({ message: 'Not a failure, ignored' });
    }

    const repoFullName = repo.full_name;
    const [owner, repoName] = repoFullName.split('/');

    // Check rate limit
    const rateCheck = await checkRateLimit(repoFullName);
    if (!rateCheck.allowed) {
        logger.warn('Rate limit exceeded for repository', {
            repoFullName,
            reason: rateCheck.reason,
        });
        return res.status(429).json({
            error: 'Rate limit exceeded',
            reason: rateCheck.reason,
        });
    }

    try {
        // Create failure event in database
        const failureEvent = await prisma.failureEvent.create({
            data: {
                repoFullName,
                repoOwner: owner,
                repoName,
                commitSha: job.head_sha,
                runId: job.run_id,
                jobId: job.id,
                branch: job.head_branch || 'unknown',
                workflowName: job.workflow_name,
                logsUrl: job.html_url,
                status: 'DETECTED',
            },
        });

        logger.info('Failure event created', {
            eventId: failureEvent.id,
            repoFullName,
            runId: job.run_id,
        });

        // Add to processing queue
        await fixQueue.add('process-failure', {
            eventId: failureEvent.id,
            owner,
            repo: repoName,
            commitSha: job.head_sha,
            runId: job.run_id,
            jobId: job.id,
            branch: job.head_branch,
            logsUrl: job.html_url,
            deliveryId,
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: 100,
            removeOnFail: 50,
        });

        // Increment rate limit
        await incrementRateLimit(repoFullName);

        // Respond immediately
        res.status(202).json({
            message: 'Failure detected, processing queued',
            eventId: failureEvent.id,
            queuePosition: await fixQueue.count(),
        });
    } catch (error) {
        logger.error('Failed to process workflow_job event', {
            error: error.message,
            deliveryId,
        });
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Handle workflow_run events
 */
async function handleWorkflowRun(payload, deliveryId, res) {
    const run = payload.workflow_run;
    const repo = payload.repository;

    // Only process failed runs
    if (run.conclusion !== 'failure') {
        return res.status(200).json({ message: 'Not a failure, ignored' });
    }

    const repoFullName = repo.full_name;
    const [owner, repoName] = repoFullName.split('/');

    // Check rate limit
    const rateCheck = await checkRateLimit(repoFullName);
    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: 'Rate limit exceeded',
            reason: rateCheck.reason,
        });
    }

    try {
        // Create failure event
        const failureEvent = await prisma.failureEvent.create({
            data: {
                repoFullName,
                repoOwner: owner,
                repoName,
                commitSha: run.head_sha,
                runId: run.id,
                branch: run.head_branch,
                workflowName: run.name,
                logsUrl: run.html_url,
                status: 'DETECTED',
            },
        });

        logger.info('Workflow run failure detected', {
            eventId: failureEvent.id,
            repoFullName,
            runId: run.id,
        });

        // Add to queue
        await fixQueue.add('process-failure', {
            eventId: failureEvent.id,
            owner,
            repo: repoName,
            commitSha: run.head_sha,
            runId: run.id,
            branch: run.head_branch,
            logsUrl: run.html_url,
            deliveryId,
        });

        await incrementRateLimit(repoFullName);

        res.status(202).json({
            message: 'Workflow failure detected, processing queued',
            eventId: failureEvent.id,
        });
    } catch (error) {
        logger.error('Failed to process workflow_run event', {
            error: error.message,
            deliveryId,
        });
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Handle check_run events
 */
async function handleCheckRun(payload, deliveryId, res) {
    const checkRun = payload.check_run;
    const repo = payload.repository;

    // Only process failed check runs
    if (checkRun.conclusion !== 'failure') {
        return res.status(200).json({ message: 'Not a failure, ignored' });
    }

    // Similar processing as workflow_job
    const repoFullName = repo.full_name;
    const [owner, repoName] = repoFullName.split('/');

    logger.info('Check run failure detected', {
        repoFullName,
        checkRunId: checkRun.id,
        name: checkRun.name,
    });

    // For now, log and acknowledge - could be expanded
    res.status(200).json({
        message: 'Check run failure noted',
        checkRunId: checkRun.id,
    });
}

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

/**
 * Webhook status endpoint
 */
router.get('/status', async (req, res) => {
    try {
        const [queueStats, recentEvents] = await Promise.all([
            fixQueue.getJobCounts(),
            prisma.failureEvent.findMany({
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    repoFullName: true,
                    status: true,
                    errorType: true,
                    createdAt: true,
                },
            }),
        ]);

        res.status(200).json({
            queue: queueStats,
            recentEvents,
        });
    } catch (error) {
        logger.error('Status endpoint error', { error: error.message });
        res.status(500).json({ error: 'Failed to get status' });
    }
});

export default router;
