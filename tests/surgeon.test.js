/**
 * Surgeon Agent Tests
 */

import { jest } from '@jest/globals';

// Mock modules
jest.unstable_mockModule('../src/config/gemini.js', () => ({
    generateContent: jest.fn(),
    extractCodeFromResponse: jest.fn(),
    parseJsonResponse: jest.fn(),
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

describe('Surgeon Agent', () => {
    let surgeon;
    let gemini;

    beforeEach(async () => {
        jest.resetModules();

        gemini = await import('../src/config/gemini.js');
        const surgeonModule = await import('../src/agents/surgeon.js');
        surgeon = surgeonModule.surgeon;
    });

    describe('generateFix', () => {
        it('should generate fix for simple syntax error', async () => {
            const originalCode = `
def calculate(x, y:
    return x + y
      `;
            const expectedFix = `
def calculate(x, y):
    return x + y
      `;

            gemini.generateContent.mockResolvedValue({
                text: '```python\n' + expectedFix + '\n```',
                usage: { totalTokens: 150 },
                latency: 600,
            });
            gemini.extractCodeFromResponse.mockReturnValue(expectedFix.trim());
            gemini.parseJsonResponse.mockReturnValue({
                isValid: true,
                addressesError: true,
                syntaxValid: true,
                changesAreMinimal: true,
                recommendation: 'APPROVE',
            });

            const result = await surgeon.generateFix({
                filePath: 'src/main.py',
                lineNumber: 1,
                errorType: 'SyntaxError',
                errorMessage: 'Missing closing parenthesis',
                language: 'python',
                originalCode,
            });

            expect(result.success).toBe(true);
            expect(result.fixedCode).toContain('def calculate(x, y):');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('should use Pro model for complex errors', async () => {
            const originalCode = 'const x: string = 42;';
            const expectedFix = 'const x: number = 42;';

            gemini.generateContent.mockResolvedValue({
                text: '```typescript\n' + expectedFix + '\n```',
                usage: { totalTokens: 200 },
                latency: 1000,
            });
            gemini.extractCodeFromResponse.mockReturnValue(expectedFix);
            gemini.parseJsonResponse.mockReturnValue({
                isValid: true,
                addressesError: true,
                syntaxValid: true,
                changesAreMinimal: true,
                recommendation: 'APPROVE',
            });

            const result = await surgeon.generateFix({
                filePath: 'src/app.ts',
                lineNumber: 1,
                errorType: 'TypeError',
                errorMessage: 'Type string not assignable to number',
                language: 'typescript',
                originalCode,
                useProModel: true,
            });

            expect(result.model).toBe('gemini-1.5-pro');
        });

        it('should handle fix generation failure', async () => {
            gemini.generateContent.mockRejectedValue(new Error('API error'));

            await expect(
                surgeon.generateFix({
                    filePath: 'src/app.py',
                    lineNumber: 1,
                    errorType: 'SyntaxError',
                    errorMessage: 'Error',
                    language: 'python',
                    originalCode: 'broken code',
                })
            ).rejects.toThrow('API error');
        });
    });

    describe('basicValidate', () => {
        it('should reject empty fixes', () => {
            const result = surgeon.basicValidate('original code', '');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('empty');
        });

        it('should reject identical fixes', () => {
            const code = 'const x = 1;';
            const result = surgeon.basicValidate(code, code);
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('identical');
        });

        it('should reject dramatic size changes', () => {
            const original = 'const x = 1;';
            const fixed = 'const x = 1;\n'.repeat(100);
            const result = surgeon.basicValidate(original, fixed);
            expect(result.isValid).toBe(false);
        });

        it('should accept valid fixes', () => {
            const original = 'const x = 1;';
            const fixed = 'const x = 2;';
            const result = surgeon.basicValidate(original, fixed);
            expect(result.isValid).toBe(true);
        });
    });

    describe('calculateConfidence', () => {
        it('should return higher confidence for minimal changes', () => {
            const originalCode = 'const x = 1;';
            const fixedCode = 'const x = 2;';

            const confidence = surgeon.calculateConfidence({
                originalCode,
                fixedCode,
                validation: { isValid: true, syntaxValid: true, changesAreMinimal: true },
                errorType: 'SyntaxError',
                lineNumber: 1,
            });

            expect(confidence).toBeGreaterThan(0.7);
        });

        it('should penalize potential side effects', () => {
            const originalCode = 'const x = 1;';
            const fixedCode = 'const x = 2;';

            const withSideEffects = surgeon.calculateConfidence({
                originalCode,
                fixedCode,
                validation: {
                    isValid: true,
                    syntaxValid: true,
                    potentialSideEffects: ['May break other functions'],
                },
                errorType: 'SyntaxError',
                lineNumber: 1,
            });

            const withoutSideEffects = surgeon.calculateConfidence({
                originalCode,
                fixedCode,
                validation: { isValid: true, syntaxValid: true, changesAreMinimal: true },
                errorType: 'SyntaxError',
                lineNumber: 1,
            });

            expect(withSideEffects).toBeLessThan(withoutSideEffects);
        });
    });

    describe('generateDiffSummary', () => {
        it('should show added lines', () => {
            const original = 'line1';
            const fixed = 'line1\nline2';

            const summary = surgeon.generateDiffSummary(original, fixed);

            expect(summary).toContain('Added');
        });

        it('should show removed lines', () => {
            const original = 'line1\nline2';
            const fixed = 'line1';

            const summary = surgeon.generateDiffSummary(original, fixed);

            expect(summary).toContain('Removed');
        });

        it('should show changed lines', () => {
            const original = 'const x = 1;';
            const fixed = 'const x = 2;';

            const summary = surgeon.generateDiffSummary(original, fixed);

            expect(summary).toContain('Changed');
        });
    });

    describe('isComplexError', () => {
        it('should identify complex error types', () => {
            expect(surgeon.isComplexError('TypeError', 'code')).toBe(true);
            expect(surgeon.isComplexError('NullPointerException', 'code')).toBe(true);
        });

        it('should identify large files as complex', () => {
            const largeCode = 'line\n'.repeat(250);
            expect(surgeon.isComplexError('SyntaxError', largeCode)).toBe(true);
        });

        it('should not flag simple syntax errors', () => {
            expect(surgeon.isComplexError('SyntaxError', 'small code')).toBe(false);
        });
    });
});
