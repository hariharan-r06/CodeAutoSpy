/**
 * Fix Queue
 * Bull queue for async processing of failure fixes
 */

import Queue from 'bull';
import prisma from '../config/database.js';
import { scout } from '../agents/scout.js';
import { retriever } from '../agents/retriever.js';
import { surgeon } from '../agents/surgeon.js';
import { operator } from '../agents/operator.js';
import { sendDiscordNotification, NotificationType } from '../notifications/discord.js';
import { sendSlackNotification } from '../notifications/slack.js';
import logger from '../utils/logger.js';

// Initialize Bull queue with Redis
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const fixQueue = new Queue('codeautopsy-fixes', redisUrl, {
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
    limiter: {
        max: 5,
        duration: 60000, // 5 jobs per minute
    },
});

/**
 * Main job processor - orchestrates the entire fix pipeline
 */
fixQueue.process('process-failure', async (job) => {
    const { eventId, owner, repo, commitSha, runId, logsUrl, branch } = job.data;
    const startTime = Date.now();

    logger.info('Processing failure', { eventId, owner, repo, runId });

    try {
        // Update status to ANALYZING
        await updateEventStatus(eventId, 'ANALYZING');
        job.progress(10);

        // Step 1: Fetch build logs
        logger.debug('Fetching build logs');
        const buildLog = await fetchBuildLogs(owner, repo, runId);

        if (!buildLog) {
            throw new Error('Could not fetch build logs');
        }
        job.progress(20);

        // Step 2: Scout - Analyze logs to find broken file
        logger.debug('Analyzing logs with Scout agent');
        const scoutResult = await scout.analyze(buildLog);

        await prisma.failureEvent.update({
            where: { id: eventId },
            data: {
                filePath: scoutResult.filePath,
                lineNumber: scoutResult.lineNumber,
                errorType: scoutResult.errorType,
                errorMessage: scoutResult.errorMessage,
                language: scoutResult.language,
                rawLog: buildLog.substring(0, 10000), // Store first 10KB
            },
        });

        if (!scoutResult.filePath) {
            throw new Error('Could not identify failing file from logs');
        }

        // Normalize the file path to remove GitHub Actions runner prefixes
        // and duplicate repo names (e.g., "repo/repo/src" -> "src")
        let normalizedFilePath = scoutResult.filePath
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');

        // Remove GitHub Actions runner path patterns
        const runnerPatterns = [
            /^\/home\/runner\/work\/[^/]+\/[^/]+\//i,
            /^home\/runner\/work\/[^/]+\/[^/]+\//i,
        ];
        for (const pattern of runnerPatterns) {
            normalizedFilePath = normalizedFilePath.replace(pattern, '');
        }

        // Remove duplicate repo name prefix (repo-name/repo-name/src -> src)
        const duplicatePattern = /^([^/]+)\/\1\//;
        if (duplicatePattern.test(normalizedFilePath)) {
            normalizedFilePath = normalizedFilePath.replace(duplicatePattern, '');
        }

        // Update scoutResult with normalized path
        scoutResult.filePath = normalizedFilePath;

        logger.info('Scout found error', {
            filePath: scoutResult.filePath,
            errorType: scoutResult.errorType,
            confidence: scoutResult.confidence,
        });
        job.progress(35);

        // Check if file is protected
        if (isProtectedPath(scoutResult.filePath)) {
            await updateEventStatus(eventId, 'SKIPPED', 'Protected file path');
            return { status: 'skipped', reason: 'Protected file path' };
        }

        // Step 3: Retriever - Fetch source code
        await updateEventStatus(eventId, 'RETRIEVING');
        logger.debug('Retrieving source code with Retriever agent');

        const fileData = await retriever.retrieveWithContext({
            owner,
            repo,
            filePath: scoutResult.filePath,
            lineNumber: scoutResult.lineNumber,
            ref: commitSha,
        });
        job.progress(50);

        // Step 4: Surgeon - Generate fix
        await updateEventStatus(eventId, 'FIXING');
        logger.debug('Generating fix with Surgeon agent');

        const fixResult = await surgeon.generateFix({
            filePath: scoutResult.filePath,
            lineNumber: scoutResult.lineNumber,
            errorType: scoutResult.errorType,
            errorMessage: scoutResult.errorMessage,
            language: scoutResult.language || fileData.language,
            originalCode: fileData.content,
            relevantLogSection: buildLog.substring(0, 5000),
        });

        if (!fixResult.success) {
            throw new Error('Surgeon failed to generate fix');
        }

        // Store fix attempt
        await prisma.fixAttempt.create({
            data: {
                failureEventId: eventId,
                originalCode: fileData.content,
                fixedCode: fixResult.fixedCode,
                diffSummary: fixResult.diffSummary,
                confidence: fixResult.confidence,
                validationPassed: fixResult.validation.isValid,
                geminiModel: fixResult.model,
                latencyMs: fixResult.latency,
            },
        });

        logger.info('Fix generated', {
            confidence: fixResult.confidence,
            model: fixResult.model,
        });
        job.progress(70);

        // Step 5: Validate confidence and decide action
        await updateEventStatus(eventId, 'VALIDATING');
        job.progress(80);

        const minConfidence = parseFloat(process.env.MIN_CONFIDENCE_FOR_PR) || 0.85;

        let operatorResult;

        if (fixResult.confidence >= minConfidence) {
            // High confidence - create PR
            logger.debug('Creating PR with Operator agent');
            operatorResult = await operator.createFixPR({
                owner,
                repo,
                filePath: scoutResult.filePath,
                originalCode: fileData.content,
                fixedCode: fixResult.fixedCode,
                commitSha,
                errorInfo: {
                    ...scoutResult,
                    confidence: fixResult.confidence,
                },
                diffSummary: fixResult.diffSummary,
                runId,
                logsUrl,
            });

            await prisma.failureEvent.update({
                where: { id: eventId },
                data: {
                    status: 'PR_CREATED',
                    prUrl: operatorResult.prUrl,
                    prNumber: operatorResult.prNumber,
                    confidence: fixResult.confidence,
                },
            });

            // Update fix attempt as applied
            await prisma.fixAttempt.updateMany({
                where: { failureEventId: eventId },
                data: { applied: true },
            });
        } else {
            // Low confidence - create issue for manual review
            logger.debug('Confidence too low, creating issue instead');
            operatorResult = await operator.createManualReviewIssue({
                owner,
                repo,
                filePath: scoutResult.filePath,
                errorInfo: scoutResult,
                buildLog: buildLog.substring(0, 5000),
                attemptedFix: fixResult.diffSummary,
                failureReason: `Confidence score (${(fixResult.confidence * 100).toFixed(0)}%) below threshold (${(minConfidence * 100).toFixed(0)}%)`,
                runId,
                logsUrl,
            });

            await prisma.failureEvent.update({
                where: { id: eventId },
                data: {
                    status: 'MANUAL_REVIEW',
                    confidence: fixResult.confidence,
                },
            });
        }
        job.progress(95);

        // Step 6: Send notifications
        const notificationData = {
            eventId,
            repoFullName: `${owner}/${repo}`,
            branch,
            errorType: scoutResult.errorType,
            filePath: scoutResult.filePath,
            prUrl: operatorResult.prUrl,
            prNumber: operatorResult.prNumber,
            issueUrl: operatorResult.issueUrl,
            issueNumber: operatorResult.issueNumber,
            confidence: fixResult.confidence,
            isAutoFix: fixResult.confidence >= minConfidence,
        };

        await sendNotifications(notificationData, eventId);
        job.progress(100);

        const duration = Date.now() - startTime;
        logger.info('Failure processing complete', {
            eventId,
            duration: `${duration}ms`,
            result: operatorResult.prUrl ? 'PR created' : 'Issue created',
        });

        return {
            status: 'success',
            prUrl: operatorResult.prUrl,
            issueUrl: operatorResult.issueUrl,
            confidence: fixResult.confidence,
            duration,
        };
    } catch (error) {
        logger.error('Failure processing failed', {
            eventId,
            error: error.message,
            stack: error.stack,
        });

        await updateEventStatus(eventId, 'FAILED', error.message);

        // Send failure notification
        await sendNotifications({
            eventId,
            repoFullName: `${owner}/${repo}`,
            branch,
            error: error.message,
            isFailure: true,
        }, eventId);

        throw error;
    }
});

/**
 * Update event status in database
 */
async function updateEventStatus(eventId, status, errorMessage = null) {
    try {
        const data = { status };
        if (status === 'FIXED' || status === 'PR_CREATED') {
            data.fixedAt = new Date();
        }
        if (errorMessage) {
            data.errorMessage = errorMessage;
        }

        await prisma.failureEvent.update({
            where: { id: eventId },
            data,
        });
    } catch (error) {
        logger.error('Failed to update event status', { eventId, status, error: error.message });
    }
}

/**
 * Fetch build logs from GitHub
 */
async function fetchBuildLogs(owner, repo, runId) {
    try {
        const octokit = (await import('../config/github.js')).default;
        const axios = (await import('axios')).default;

        // Get jobs for the workflow run
        const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
            owner,
            repo,
            run_id: runId,
        });

        // Find the failed job
        const failedJob = jobs.jobs.find(job => job.conclusion === 'failure');

        if (!failedJob) {
            logger.warn('No failed job found', { owner, repo, runId });
            return null;
        }

        // Get the job logs
        try {
            // GitHub API returns a redirect URL for logs, we need to follow it
            const logUrl = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${failedJob.id}/logs`;

            const response = await axios.get(logUrl, {
                headers: {
                    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
                maxRedirects: 5,
                responseType: 'text',
            });

            // GitHub returns logs as plain text (not JSON)
            if (typeof response.data === 'string') {
                return response.data;
            }

            return String(response.data);
        } catch (logError) {
            // If direct log fetch fails, try to extract error info from job steps
            logger.warn('Could not download job logs directly', {
                error: logError.message,
                status: logError.response?.status,
            });

            // Try to get step annotations and error messages
            const stepErrors = [];

            if (failedJob.steps) {
                for (const step of failedJob.steps) {
                    if (step.conclusion === 'failure') {
                        stepErrors.push(`Step "${step.name}" failed at ${step.completed_at || 'unknown time'}`);
                    }
                }
            }

            // Add job-level error if available
            if (failedJob.conclusion === 'failure') {
                stepErrors.push(`Job "${failedJob.name}" failed with conclusion: ${failedJob.conclusion}`);
            }

            return stepErrors.length > 0
                ? stepErrors.join('\n')
                : 'Build failed but logs unavailable. Check the workflow run in GitHub for details.';
        }
    } catch (error) {
        logger.error('Failed to fetch build logs', { owner, repo, runId, error: error.message });
        return null;
    }
}

/**
 * Check if path is protected
 */
function isProtectedPath(filePath) {
    const protectedPaths = (process.env.PROTECTED_PATHS || 'config,secrets,.github/workflows,.env')
        .split(',')
        .map(p => p.trim().toLowerCase());

    const lowerPath = filePath.toLowerCase();
    return protectedPaths.some(p => lowerPath.includes(p));
}

/**
 * Send notifications about the fix
 */
async function sendNotifications(data, eventId) {
    const promises = [];

    // Discord notification
    if (process.env.DISCORD_WEBHOOK_URL) {
        promises.push(
            sendDiscordNotification(data, data.isFailure ? NotificationType.ERROR : NotificationType.SUCCESS)
                .then(result => {
                    if (result.success) {
                        return prisma.notification.create({
                            data: {
                                failureEventId: eventId,
                                channel: 'DISCORD',
                                status: 'SENT',
                                sentAt: new Date(),
                            },
                        });
                    }
                })
                .catch(error => logger.error('Discord notification failed', { error: error.message }))
        );
    }

    // Slack notification
    if (process.env.SLACK_WEBHOOK_URL) {
        promises.push(
            sendSlackNotification(data, data.isFailure ? 'error' : 'success')
                .then(result => {
                    if (result.success) {
                        return prisma.notification.create({
                            data: {
                                failureEventId: eventId,
                                channel: 'SLACK',
                                status: 'SENT',
                                sentAt: new Date(),
                            },
                        });
                    }
                })
                .catch(error => logger.error('Slack notification failed', { error: error.message }))
        );
    }

    await Promise.allSettled(promises);
}

// Queue event handlers
fixQueue.on('completed', (job, result) => {
    logger.info('Job completed', { jobId: job.id, result });
});

fixQueue.on('failed', (job, error) => {
    logger.error('Job failed', { jobId: job.id, error: error.message, attempts: job.attemptsMade });
});

fixQueue.on('stalled', (job) => {
    logger.warn('Job stalled', { jobId: job.id });
});

fixQueue.on('error', (error) => {
    logger.error('Queue error', { error: error.message });
});

// Graceful shutdown
export async function closeQueue() {
    await fixQueue.close();
    logger.info('Fix queue closed');
}

export default fixQueue;
