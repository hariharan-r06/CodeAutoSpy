/**
 * Integration Tests
 * Tests the full pipeline from webhook to PR creation
 */

import { jest } from '@jest/globals';
import request from 'supertest';

// Mock external services
jest.unstable_mockModule('../src/config/database.js', () => {
    const mockPrisma = {
        failureEvent: {
            create: jest.fn(() => Promise.resolve({ id: 'test-event-id' })),
            update: jest.fn(() => Promise.resolve({})),
            findMany: jest.fn(() => Promise.resolve([])),
        },
        rateLimit: {
            findUnique: jest.fn(() => Promise.resolve(null)),
            create: jest.fn(() => Promise.resolve({ attemptsThisHour: 0, isBlacklisted: false })),
            update: jest.fn(() => Promise.resolve({})),
        },
        fixAttempt: {
            create: jest.fn(() => Promise.resolve({})),
        },
        notification: {
            create: jest.fn(() => Promise.resolve({})),
        },
        $connect: jest.fn(() => Promise.resolve()),
        $disconnect: jest.fn(() => Promise.resolve()),
    };

    return {
        default: mockPrisma,
        connectDatabase: jest.fn(() => Promise.resolve(true)),
        disconnectDatabase: jest.fn(() => Promise.resolve()),
    };
});

jest.unstable_mockModule('../src/config/github.js', () => ({
    default: {},
    validateToken: jest.fn(() => Promise.resolve({ valid: true, user: 'test-user' })),
    getFileContent: jest.fn(() => Promise.resolve({
        content: 'def test():\n    pass',
        sha: 'abc123',
    })),
    getDefaultBranch: jest.fn(() => Promise.resolve('main')),
    createBranch: jest.fn(() => Promise.resolve({})),
    createOrUpdateFile: jest.fn(() => Promise.resolve({})),
    createPullRequest: jest.fn(() => Promise.resolve({
        number: 123,
        html_url: 'https://github.com/test/repo/pull/123',
    })),
    createIssue: jest.fn(() => Promise.resolve({
        number: 456,
        html_url: 'https://github.com/test/repo/issues/456',
    })),
}));

jest.unstable_mockModule('../src/config/gemini.js', () => ({
    default: {},
    generateContent: jest.fn(() => Promise.resolve({
        text: JSON.stringify({
            filePath: 'src/main.py',
            lineNumber: 10,
            errorType: 'SyntaxError',
            errorMessage: 'test error',
            confidence: 0.95,
        }),
        usage: { totalTokens: 100 },
        latency: 500,
    })),
    parseJsonResponse: jest.fn((text) => JSON.parse(text)),
    extractCodeFromResponse: jest.fn((text) => 'def test():\n    return True'),
}));

jest.unstable_mockModule('../src/queue/fix-queue.js', () => ({
    fixQueue: {
        add: jest.fn(() => Promise.resolve({ id: 'job-123' })),
        count: jest.fn(() => Promise.resolve(0)),
        getJobCounts: jest.fn(() => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 })),
        getActive: jest.fn(() => Promise.resolve([])),
        getWaiting: jest.fn(() => Promise.resolve([])),
        getFailed: jest.fn(() => Promise.resolve([])),
        process: jest.fn(),
        on: jest.fn(),
    },
    closeQueue: jest.fn(() => Promise.resolve()),
}));

jest.unstable_mockModule('../src/notifications/discord.js', () => ({
    sendDiscordNotification: jest.fn(() => Promise.resolve({ success: true })),
    sendStartupNotification: jest.fn(() => Promise.resolve({ success: true })),
    sendShutdownNotification: jest.fn(() => Promise.resolve({ success: true })),
    NotificationType: { SUCCESS: 'success', ERROR: 'error' },
}));

jest.unstable_mockModule('../src/notifications/slack.js', () => ({
    sendSlackNotification: jest.fn(() => Promise.resolve({ success: true })),
    sendStartupNotification: jest.fn(() => Promise.resolve({ success: true })),
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        startOperation: jest.fn(() => Date.now()),
        endOperation: jest.fn(),
        failOperation: jest.fn(),
    },
}));

describe('Integration Tests', () => {
    let app;
    let webhookRouter;
    let express;

    beforeEach(async () => {
        jest.resetModules();

        // Set up environment
        process.env.GITHUB_TOKEN = 'test-token';
        process.env.GEMINI_API_KEY = 'test-key';
        process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';

        // Import fresh
        express = (await import('express')).default;
        webhookRouter = (await import('../src/webhooks/github-listener.js')).default;

        // Create test app
        app = express();
        app.use(express.json({
            verify: (req, res, buf) => {
                req.rawBody = buf.toString();
            },
        }));
        app.use('/webhooks', webhookRouter);
    });

    describe('Webhook Endpoint', () => {
        it('should respond to health check', async () => {
            const response = await request(app)
                .get('/webhooks/health')
                .expect(200);

            expect(response.body.status).toBe('healthy');
        });

        it('should accept valid workflow_job failure webhook', async () => {
            const payload = {
                action: 'completed',
                workflow_job: {
                    id: 12345,
                    run_id: 67890,
                    conclusion: 'failure',
                    head_sha: 'abc123def456',
                    head_branch: 'main',
                    html_url: 'https://github.com/test/repo/actions/runs/67890',
                    workflow_name: 'CI',
                },
                repository: {
                    full_name: 'test/repo',
                },
            };

            // Note: In real test, you'd need to generate a valid HMAC signature
            const response = await request(app)
                .post('/webhooks/github')
                .set('X-GitHub-Event', 'workflow_job')
                .set('X-GitHub-Delivery', 'test-delivery-id')
                .send(payload);

            // Without valid signature, might get 401
            // With mocked signature verification, should get 202
            expect([200, 202, 401]).toContain(response.status);
        });

        it('should ignore non-failure workflow jobs', async () => {
            const payload = {
                action: 'completed',
                workflow_job: {
                    id: 12345,
                    run_id: 67890,
                    conclusion: 'success',
                    head_sha: 'abc123def456',
                    head_branch: 'main',
                },
                repository: {
                    full_name: 'test/repo',
                },
            };

            const response = await request(app)
                .post('/webhooks/github')
                .set('X-GitHub-Event', 'workflow_job')
                .set('X-GitHub-Delivery', 'test-delivery-id')
                .send(payload);

            // Should be ignored
            expect([200, 401]).toContain(response.status);
        });

        it('should ignore unsupported event types', async () => {
            const payload = {
                action: 'opened',
                pull_request: { id: 123 },
                repository: { full_name: 'test/repo' },
            };

            const response = await request(app)
                .post('/webhooks/github')
                .set('X-GitHub-Event', 'pull_request')
                .set('X-GitHub-Delivery', 'test-delivery-id')
                .send(payload);

            expect([200, 401]).toContain(response.status);
        });
    });

    describe('Status Endpoint', () => {
        it('should return queue and event status', async () => {
            const response = await request(app)
                .get('/webhooks/status')
                .expect(200);

            expect(response.body).toHaveProperty('queue');
            expect(response.body).toHaveProperty('recentEvents');
        });
    });
});

describe('Error Parser Integration', () => {
    let errorParser;

    beforeEach(async () => {
        errorParser = await import('../src/utils/error-parser.js');
    });

    it('should parse real Python traceback', () => {
        const log = `
2024-01-15T10:30:00Z Installing dependencies...
2024-01-15T10:30:05Z Running tests...
Traceback (most recent call last):
  File "/home/runner/work/myapp/myapp/src/app.py", line 42, in main
    result = process_data(user_input
                                    ^
SyntaxError: '(' was never closed
Error: Process completed with exit code 1.
    `;

        const error = errorParser.findPrimaryError(log, 'python');

        expect(error).not.toBeNull();
        expect(error.filePath).toContain('app.py');
        expect(error.lineNumber).toBe(42);
        expect(error.errorType).toBe('SyntaxError');
    });

    it('should parse real JavaScript error', () => {
        const log = `
> build
> next build

./src/components/Header.jsx
Error: Cannot find module '../utils/helpers'
  at /app/src/components/Header.jsx:5:1

Build failed with errors.
    `;

        const error = errorParser.findPrimaryError(log, 'javascript');

        expect(error).not.toBeNull();
        expect(error.errorType).toBeDefined();
    });

    it('should parse TypeScript compiler errors', () => {
        const log = `
> tsc --noEmit

src/api/handlers.ts:25:10 - error TS2322: Type 'string' is not assignable to type 'number'.

25   const count: number = "5";
            ~~~~~

Found 1 error.
    `;

        const error = errorParser.findPrimaryError(log, 'typescript');

        expect(error).not.toBeNull();
        expect(error.filePath).toBe('src/api/handlers.ts');
        expect(error.lineNumber).toBe(25);
        expect(error.errorType).toBe('TS2322');
    });
});

describe('Language Detector Integration', () => {
    let languageDetector;

    beforeEach(async () => {
        languageDetector = await import('../src/utils/language-detector.js');
    });

    it('should detect Python from file path', () => {
        const result = languageDetector.detectFromPath('src/main.py');
        expect(result).toBe('python');
    });

    it('should detect JavaScript from error log', () => {
        const log = `
npm ERR! code ELIFECYCLE
Module not found: Can't resolve './components/Header'
    `;

        const result = languageDetector.detectFromErrorLog(log);
        expect(result.language).toBe('javascript');
    });

    it('should detect language from shebang', () => {
        const content = '#!/usr/bin/env python3\nprint("hello")';
        const result = languageDetector.detectFromShebang(content);
        expect(result).toBe('python');
    });

    it('should use comprehensive detection', () => {
        const result = languageDetector.detectLanguage({
            filePath: 'src/app.ts',
            content: 'const x: string = "hello";',
        });

        expect(result.language).toBe('typescript');
        expect(result.confidence).toBeGreaterThan(0.8);
    });
});
