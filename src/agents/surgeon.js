/**
 * Surgeon Agent
 * Generates code fixes using Gemini AI
 */

import { generateContent, extractCodeFromResponse, parseJsonResponse } from '../config/ai-provider.js';
import {
    getSurgeonPrompt,
    getComplexFixPrompt,
    getImportFixPrompt,
    getValidationPrompt,
    getSyntaxFixPrompt,
} from '../prompts/surgeon-prompt.js';
import { getConfidencePrompt } from '../prompts/analysis-prompt.js';
import errorParser from '../utils/error-parser.js';
import logger from '../utils/logger.js';

/**
 * Surgeon Agent - Generates code fixes
 */
class SurgeonAgent {
    constructor() {
        this.name = 'Surgeon';
    }

    /**
     * Generate a fix for a code error
     * @param {object} params - Fix parameters
     * @returns {Promise<object>} Fix result
     */
    async generateFix({
        filePath,
        lineNumber,
        errorType,
        errorMessage,
        language,
        originalCode,
        relevantLogSection = null,
        additionalContext = '',
        useProModel = false,
    }) {
        const startTime = logger.startOperation('SurgeonAgent.generateFix', {
            filePath,
            errorType,
            language,
        });

        try {
            // Choose model based on complexity
            const modelType = useProModel || this.isComplexError(errorType, originalCode)
                ? 'PRO'
                : 'FLASH';

            // Generate the fix
            const prompt = getSurgeonPrompt({
                filePath,
                lineNumber,
                errorType,
                errorMessage,
                language,
                originalCode,
                relevantLogSection,
                additionalContext,
            });

            const { text, usage, latency } = await generateContent(prompt, modelType);
            const fixedCode = extractCodeFromResponse(text, language);

            // Validate the fix
            const validation = await this.validateFix(originalCode, fixedCode, language, errorMessage);

            // Calculate confidence
            const confidence = this.calculateConfidence({
                originalCode,
                fixedCode,
                validation,
                errorType,
                lineNumber,
            });

            // Generate diff summary
            const diffSummary = this.generateDiffSummary(originalCode, fixedCode);

            const result = {
                success: validation.isValid,
                fixedCode,
                originalCode,
                diffSummary,
                confidence,
                validation,
                model: modelType === 'PRO' ? 'gemini-1.5-pro' : 'gemini-1.5-flash',
                tokens: usage.totalTokens,
                latency,
            };

            logger.endOperation('SurgeonAgent.generateFix', startTime, {
                success: result.success,
                confidence: result.confidence,
                model: result.model,
            });

            return result;
        } catch (error) {
            logger.failOperation('SurgeonAgent.generateFix', startTime, error);
            throw error;
        }
    }

    /**
     * Generate fix for syntax errors (simplified prompt)
     * @param {object} params - Fix parameters
     * @returns {Promise<object>} Fix result
     */
    async fixSyntaxError({ filePath, lineNumber, language, originalCode, errorMessage }) {
        const startTime = logger.startOperation('SurgeonAgent.fixSyntaxError');

        try {
            const prompt = getSyntaxFixPrompt({
                filePath,
                lineNumber,
                language,
                originalCode,
                errorMessage,
            });

            const { text, usage, latency } = await generateContent(prompt, 'FLASH');
            const fixedCode = extractCodeFromResponse(text, language);

            const diffSummary = this.generateDiffSummary(originalCode, fixedCode);
            const validation = { isValid: true, syntaxValid: true };
            const confidence = this.calculateConfidence({
                originalCode,
                fixedCode,
                validation,
                errorType: 'SyntaxError',
                lineNumber,
            });

            logger.endOperation('SurgeonAgent.fixSyntaxError', startTime);

            return {
                success: true,
                fixedCode,
                originalCode,
                diffSummary,
                confidence,
                validation,
                model: 'gemini-1.5-flash',
                tokens: usage.totalTokens,
                latency,
            };
        } catch (error) {
            logger.failOperation('SurgeonAgent.fixSyntaxError', startTime, error);
            throw error;
        }
    }

    /**
     * Generate fix for import/module errors
     * @param {object} params - Fix parameters
     * @returns {Promise<object>} Fix result
     */
    async fixImportError({
        filePath,
        missingModule,
        language,
        originalCode,
        packageFile = null,
        existingImports = [],
    }) {
        const startTime = logger.startOperation('SurgeonAgent.fixImportError');

        try {
            const prompt = getImportFixPrompt({
                filePath,
                missingModule,
                language,
                originalCode,
                packageFile,
                existingImports,
            });

            const { text, usage, latency } = await generateContent(prompt, 'FLASH');
            const result = parseJsonResponse(text);

            const diffSummary = this.generateDiffSummary(originalCode, result.fixedCode);

            logger.endOperation('SurgeonAgent.fixImportError', startTime);

            return {
                success: true,
                fixedCode: result.fixedCode,
                originalCode,
                diffSummary,
                confidence: result.confidence,
                fixType: result.fixType,
                correctedImport: result.correctedImport,
                needsPackageUpdate: result.needsPackageUpdate,
                packageInstallCommand: result.packageInstallCommand,
                model: 'gemini-1.5-flash',
                tokens: usage.totalTokens,
                latency,
            };
        } catch (error) {
            logger.failOperation('SurgeonAgent.fixImportError', startTime, error);
            throw error;
        }
    }

    /**
     * Generate fix for complex multi-location errors
     * @param {object} params - Fix parameters
     * @returns {Promise<object>} Fix result
     */
    async fixComplexError({
        filePath,
        errorType,
        errorMessage,
        language,
        originalCode,
        errorLines,
        relatedFiles = [],
    }) {
        const startTime = logger.startOperation('SurgeonAgent.fixComplexError');

        try {
            const prompt = getComplexFixPrompt({
                filePath,
                errorType,
                errorMessage,
                language,
                originalCode,
                errorLines,
                relatedFiles,
            });

            // Use Pro model for complex fixes
            const { text, usage, latency } = await generateContent(prompt, 'PRO');
            const result = parseJsonResponse(text);

            const diffSummary = this.generateDiffSummary(originalCode, result.fixedCode);

            logger.endOperation('SurgeonAgent.fixComplexError', startTime);

            return {
                success: true,
                fixedCode: result.fixedCode,
                originalCode,
                diffSummary,
                changesDescription: result.changesDescription,
                confidence: result.confidence,
                model: 'gemini-1.5-pro',
                tokens: usage.totalTokens,
                latency,
            };
        } catch (error) {
            logger.failOperation('SurgeonAgent.fixComplexError', startTime, error);
            throw error;
        }
    }

    /**
     * Validate a proposed fix
     * @param {string} originalCode - Original code
     * @param {string} fixedCode - Proposed fix
     * @param {string} language - Programming language
     * @param {string} errorMessage - Original error
     * @returns {Promise<object>} Validation result
     */
    async validateFix(originalCode, fixedCode, language, errorMessage) {
        // Basic validation first
        const basicValidation = this.basicValidate(originalCode, fixedCode);
        if (!basicValidation.isValid) {
            return basicValidation;
        }

        try {
            // AI validation for more complex checks
            const prompt = getValidationPrompt(originalCode, fixedCode, language, errorMessage);
            const { text } = await generateContent(prompt, 'FLASH');
            const result = parseJsonResponse(text);

            return {
                isValid: result.isValid && result.addressesError,
                syntaxValid: result.syntaxValid,
                addressesError: result.addressesError,
                changesAreMinimal: result.changesAreMinimal,
                introducesNewIssues: result.introducesNewIssues,
                potentialSideEffects: result.potentialSideEffects || [],
                recommendation: result.recommendation,
                source: 'ai_validation',
            };
        } catch (error) {
            logger.warn('AI validation failed, using basic validation', { error: error.message });
            return basicValidation;
        }
    }

    /**
     * Basic validation without AI
     * @param {string} originalCode - Original code
     * @param {string} fixedCode - Proposed fix
     * @returns {object} Validation result
     */
    basicValidate(originalCode, fixedCode) {
        // Check if fix is empty
        if (!fixedCode || fixedCode.trim().length === 0) {
            return {
                isValid: false,
                reason: 'Fixed code is empty',
                source: 'basic_validation',
            };
        }

        // Check if fix is identical to original
        if (originalCode.trim() === fixedCode.trim()) {
            return {
                isValid: false,
                reason: 'Fixed code is identical to original',
                source: 'basic_validation',
            };
        }

        // Check for dramatic size changes
        const originalLines = originalCode.split('\n').length;
        const fixedLines = fixedCode.split('\n').length;
        const lineDiff = Math.abs(fixedLines - originalLines);

        if (lineDiff > originalLines * 0.5) {
            return {
                isValid: false,
                reason: `Too many lines changed: ${lineDiff} lines difference`,
                source: 'basic_validation',
            };
        }

        return {
            isValid: true,
            syntaxValid: true, // Assume valid without parsing
            source: 'basic_validation',
        };
    }

    /**
     * Calculate confidence score for a fix
     * @param {object} params - Calculation parameters
     * @returns {number} Confidence score (0-1)
     */
    calculateConfidence({ originalCode, fixedCode, validation, errorType, lineNumber }) {
        let confidence = 0.5; // Base confidence

        // Boost for minimal changes
        const changeRatio = this.calculateChangeRatio(originalCode, fixedCode);
        if (changeRatio < 0.05) confidence += 0.2;
        else if (changeRatio < 0.1) confidence += 0.15;
        else if (changeRatio < 0.2) confidence += 0.1;

        // Boost for validation passing
        if (validation.isValid) confidence += 0.15;
        if (validation.syntaxValid) confidence += 0.05;
        if (validation.changesAreMinimal) confidence += 0.1;

        // Boost for common error types (more confident in known patterns)
        const commonErrors = ['SyntaxError', 'IndentationError', 'ImportError', 'ModuleNotFoundError'];
        if (commonErrors.includes(errorType)) {
            confidence += 0.1;
        }

        // Boost if we know the exact line
        if (lineNumber) confidence += 0.05;

        // Penalty for potential side effects
        if (validation.potentialSideEffects?.length > 0) {
            confidence -= 0.1 * validation.potentialSideEffects.length;
        }

        // Penalty for new issues
        if (validation.introducesNewIssues) {
            confidence -= 0.2;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Calculate the ratio of changed content
     * @param {string} original - Original code
     * @param {string} fixed - Fixed code
     * @returns {number} Change ratio (0-1)
     */
    calculateChangeRatio(original, fixed) {
        const originalChars = original.length;
        let diffChars = 0;

        // Simple character difference calculation
        const maxLen = Math.max(original.length, fixed.length);
        const minLen = Math.min(original.length, fixed.length);

        for (let i = 0; i < minLen; i++) {
            if (original[i] !== fixed[i]) diffChars++;
        }

        diffChars += maxLen - minLen;

        return diffChars / Math.max(originalChars, 1);
    }

    /**
     * Generate a human-readable diff summary
     * @param {string} original - Original code
     * @param {string} fixed - Fixed code
     * @returns {string} Diff summary
     */
    generateDiffSummary(original, fixed) {
        const originalLines = original.split('\n');
        const fixedLines = fixed.split('\n');

        const changes = [];
        const maxLines = Math.max(originalLines.length, fixedLines.length);

        for (let i = 0; i < maxLines; i++) {
            const origLine = originalLines[i];
            const fixedLine = fixedLines[i];

            if (origLine !== fixedLine) {
                if (origLine && !fixedLine) {
                    changes.push(`- Line ${i + 1}: Removed: \`${origLine.trim().substring(0, 50)}...\``);
                } else if (!origLine && fixedLine) {
                    changes.push(`+ Line ${i + 1}: Added: \`${fixedLine.trim().substring(0, 50)}...\``);
                } else {
                    changes.push(`~ Line ${i + 1}: Changed`);
                }
            }
        }

        if (changes.length === 0) {
            return 'No visible changes';
        }

        if (changes.length > 10) {
            return `${changes.slice(0, 5).join('\n')}\n... and ${changes.length - 5} more changes`;
        }

        return changes.join('\n');
    }

    /**
     * Check if error type requires complex fix
     * @param {string} errorType - Error type
     * @param {string} code - Code content
     * @returns {boolean} Whether complex fix is needed
     */
    isComplexError(errorType, code) {
        const complexTypes = [
            'TypeError',
            'ReferenceError',
            'NullPointerException',
            'TemplateError',
            'LinkerError',
        ];

        if (complexTypes.some(t => errorType?.includes(t))) {
            return true;
        }

        // If file is large, use Pro model
        if (code.split('\n').length > 200) {
            return true;
        }

        return false;
    }

    /**
     * Get a summary for the fix
     * @param {object} result - Fix result
     * @returns {string} Human-readable summary
     */
    getSummary(result) {
        if (!result.success) {
            return 'Fix generation failed';
        }

        const confidence = (result.confidence * 100).toFixed(0);
        return `Fix generated with ${confidence}% confidence using ${result.model}`;
    }
}

// Export singleton instance
export const surgeon = new SurgeonAgent();

export default surgeon;
