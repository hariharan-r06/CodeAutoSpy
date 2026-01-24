/**
 * Scout Agent Tests
 */

import { jest } from '@jest/globals';

// Mock the gemini module
jest.unstable_mockModule('../src/config/gemini.js', () => ({
    generateContent: jest.fn(),
    parseJsonResponse: jest.fn(),
}));

// Mock the logger
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

describe('Scout Agent', () => {
    let scout;
    let gemini;

    beforeEach(async () => {
        // Reset all mocks
        jest.resetModules();

        // Import fresh modules
        gemini = await import('../src/config/gemini.js');
        const scoutModule = await import('../src/agents/scout.js');
        scout = scoutModule.scout;
    });

    describe('quickParse', () => {
        it('should parse Python traceback errors', () => {
            const buildLog = `
Traceback (most recent call last):
  File "/app/src/main.py", line 42, in main
    result = calculate(x, y
                          ^
SyntaxError: '(' was never closed
      `;

            const result = scout.quickParse(buildLog);

            expect(result.filePath).toBe('app/src/main.py');
            expect(result.lineNumber).toBe(42);
            expect(result.errorType).toBe('SyntaxError');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should parse JavaScript/Node errors', () => {
            const buildLog = `
/app/src/components/Header.js:25:15
  import Header from './Headre';
                ^^^^^^

SyntaxError: Cannot find module './Headre'
      `;

            const result = scout.quickParse(buildLog);

            expect(result.filePath).toContain('Header.js');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('should parse TypeScript errors', () => {
            const buildLog = `
src/app.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.

10     const x: number = "hello";
       ~~~~~
      `;

            const result = scout.quickParse(buildLog);

            expect(result.filePath).toBe('src/app.ts');
            expect(result.lineNumber).toBe(10);
            expect(result.errorType).toBe('TS2322');
        });

        it('should return low confidence for unparseable logs', () => {
            const buildLog = 'Some random build output without clear errors';

            const result = scout.quickParse(buildLog);

            expect(result.confidence).toBe(0);
            expect(result.filePath).toBeNull();
        });
    });

    describe('analyze', () => {
        it('should use quick parse for high-confidence results', async () => {
            const buildLog = `
  File "/app/src/main.py", line 42, in main
    result = calculate(x, y
SyntaxError: '(' was never closed
      `;

            // Mock high-confidence quick parse scenario
            gemini.generateContent.mockResolvedValue({
                text: JSON.stringify({
                    filePath: 'src/main.py',
                    lineNumber: 42,
                    errorType: 'SyntaxError',
                    errorMessage: 'Missing closing parenthesis',
                    confidence: 0.95,
                }),
                usage: { totalTokens: 100 },
                latency: 500,
            });
            gemini.parseJsonResponse.mockImplementation(JSON.parse);

            const result = await scout.analyze(buildLog);

            expect(result.filePath).toBeDefined();
            expect(result.errorType).toBe('SyntaxError');
        });

        it('should fall back to AI analysis for low-confidence results', async () => {
            const buildLog = 'Some ambiguous error message';

            gemini.generateContent.mockResolvedValue({
                text: JSON.stringify({
                    filePath: 'src/utils/helper.py',
                    lineNumber: 15,
                    errorType: 'ImportError',
                    errorMessage: 'No module named pandas',
                    confidence: 0.85,
                }),
                usage: { totalTokens: 200 },
                latency: 800,
            });
            gemini.parseJsonResponse.mockImplementation(JSON.parse);

            const result = await scout.analyze(buildLog);

            expect(result.source).toBe('ai_analysis');
        });
    });

    describe('getSummary', () => {
        it('should generate readable summary', () => {
            const result = {
                filePath: 'src/app.js',
                lineNumber: 42,
                errorType: 'SyntaxError',
                confidence: 0.95,
            };

            const summary = scout.getSummary(result);

            expect(summary).toContain('src/app.js');
            expect(summary).toContain('line 42');
            expect(summary).toContain('SyntaxError');
            expect(summary).toContain('95%');
        });

        it('should handle missing file path', () => {
            const result = {
                filePath: null,
                confidence: 0,
            };

            const summary = scout.getSummary(result);

            expect(summary).toContain('Could not identify');
        });
    });
});
