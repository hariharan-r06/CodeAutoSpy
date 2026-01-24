/**
 * Scout Agent
 * Analyzes build logs to detect the source of failures
 */

import { generateContent, parseJsonResponse } from '../config/gemini.js';
import { getScoutPrompt, getFocusedScoutPrompt, getVerificationPrompt } from '../prompts/scout-prompt.js';
import errorParser from '../utils/error-parser.js';
import languageDetector from '../utils/language-detector.js';
import logger from '../utils/logger.js';

/**
 * Scout Agent - Analyzes build logs and identifies broken files
 */
class ScoutAgent {
    constructor() {
        this.name = 'Scout';
    }

    /**
     * Analyze a build log to find the source of failure
     * @param {string} buildLog - Raw build log content
     * @param {object} options - Analysis options
     * @returns {Promise<object>} Analysis result
     */
    async analyze(buildLog, options = {}) {
        const startTime = logger.startOperation('ScoutAgent.analyze');

        try {
            // Step 1: Quick parse with regex patterns
            const quickResult = this.quickParse(buildLog);
            logger.debug('Quick parse result', quickResult);

            // Step 2: Detect language from log
            const langResult = languageDetector.detectFromErrorLog(buildLog);
            const detectedLanguage = langResult?.language || options.languageHint || null;

            // Step 3: If quick parse found good results, verify with AI
            if (quickResult.confidence >= 0.8 && quickResult.filePath) {
                logger.debug('High confidence quick parse, using AI verification');
                return await this.verifyFinding(quickResult, buildLog, detectedLanguage);
            }

            // Step 4: Full AI analysis
            const aiResult = await this.aiAnalyze(buildLog, detectedLanguage);

            // Merge results, preferring AI for ambiguous cases
            const finalResult = this.mergeResults(quickResult, aiResult);

            logger.endOperation('ScoutAgent.analyze', startTime, {
                filePath: finalResult.filePath,
                errorType: finalResult.errorType,
                confidence: finalResult.confidence,
            });

            return finalResult;
        } catch (error) {
            logger.failOperation('ScoutAgent.analyze', startTime, error);
            throw error;
        }
    }

    /**
     * Quick parse using regex patterns (no AI)
     * @param {string} buildLog - Raw build log
     * @returns {object} Quick parse result
     */
    quickParse(buildLog) {
        const primaryError = errorParser.findPrimaryError(buildLog);

        if (!primaryError) {
            return {
                filePath: null,
                lineNumber: null,
                errorType: null,
                errorMessage: null,
                confidence: 0,
                source: 'quick_parse',
            };
        }

        // Normalize file path
        const filePath = errorParser.normalizeFilePath(primaryError.filePath);

        // Calculate confidence based on what we found
        let confidence = 0.5;
        if (filePath) confidence += 0.2;
        if (primaryError.lineNumber) confidence += 0.1;
        if (primaryError.errorType) confidence += 0.1;
        if (primaryError.column) confidence += 0.05;

        return {
            filePath,
            lineNumber: primaryError.lineNumber,
            column: primaryError.column,
            errorType: primaryError.errorType,
            errorMessage: primaryError.errorMessage,
            confidence: Math.min(confidence, 0.95),
            source: 'quick_parse',
            rawMatch: primaryError.rawMatch,
        };
    }

    /**
     * Full AI analysis using Gemini
     * @param {string} buildLog - Raw build log
     * @param {string} language - Detected language hint
     * @returns {Promise<object>} AI analysis result
     */
    async aiAnalyze(buildLog, language = null) {
        const startTime = Date.now();

        // Truncate log if too long (Gemini context limits)
        const maxLogLength = 50000;
        let truncatedLog = buildLog;
        if (buildLog.length > maxLogLength) {
            // Keep the most relevant part (usually the end has the error)
            truncatedLog = '... [log truncated] ...\n\n' +
                buildLog.substring(buildLog.length - maxLogLength);
        }

        const prompt = getScoutPrompt(truncatedLog, language);

        try {
            const { text, usage, latency } = await generateContent(prompt, 'FLASH');
            const result = parseJsonResponse(text);

            // Normalize file path
            if (result.filePath) {
                result.filePath = errorParser.normalizeFilePath(result.filePath);
            }

            return {
                ...result,
                source: 'ai_analysis',
                model: 'gemini-1.5-flash',
                tokens: usage.totalTokens,
                latency,
            };
        } catch (error) {
            logger.error('AI analysis failed', { error: error.message });
            return {
                filePath: null,
                lineNumber: null,
                errorType: null,
                errorMessage: null,
                confidence: 0,
                source: 'ai_analysis_failed',
                error: error.message,
            };
        }
    }

    /**
     * Verify a finding using AI (for high-confidence quick parse results)
     * @param {object} finding - Initial finding
     * @param {string} buildLog - Build log
     * @param {string} language - Detected language
     * @returns {Promise<object>} Verified result
     */
    async verifyFinding(finding, buildLog, language) {
        // If we're already highly confident and have all the info, skip
        if (finding.confidence >= 0.9 && finding.filePath && finding.lineNumber) {
            return {
                ...finding,
                verified: true,
                verificationSource: 'high_confidence_skip',
            };
        }

        // Otherwise, do a quick AI verification
        try {
            const shortLog = errorParser.extractLogContext(buildLog,
                buildLog.indexOf(finding.rawMatch || ''), 20);

            const prompt = getFocusedScoutPrompt(shortLog, finding.errorType);
            const { text } = await generateContent(prompt, 'FLASH');
            const aiResult = parseJsonResponse(text);

            // Cross-check results
            const verified = this.crossCheck(finding, aiResult);

            return {
                ...finding,
                ...verified,
                verified: true,
                verificationSource: 'ai_cross_check',
            };
        } catch (error) {
            logger.warn('Verification failed, using quick parse result', {
                error: error.message
            });
            return finding;
        }
    }

    /**
     * Cross-check quick parse and AI results
     * @param {object} quickResult - Quick parse result
     * @param {object} aiResult - AI analysis result
     * @returns {object} Cross-checked result
     */
    crossCheck(quickResult, aiResult) {
        const result = { ...quickResult };

        // If AI found a different file with higher confidence
        if (aiResult.filePath && aiResult.confidence > quickResult.confidence) {
            if (aiResult.filePath !== quickResult.filePath) {
                logger.warn('AI found different file than quick parse', {
                    quickParse: quickResult.filePath,
                    ai: aiResult.filePath,
                });
                // Use AI result if much higher confidence
                if (aiResult.confidence - quickResult.confidence > 0.2) {
                    result.filePath = aiResult.filePath;
                    result.lineNumber = aiResult.lineNumber;
                }
            }
        }

        // Use AI's error message if more detailed
        if (aiResult.errorMessage &&
            (!result.errorMessage || aiResult.errorMessage.length > result.errorMessage.length)) {
            result.errorMessage = aiResult.errorMessage;
        }

        // Use AI's suggested fix if available
        if (aiResult.suggestedFix) {
            result.suggestedFix = aiResult.suggestedFix;
        }

        // Average confidence if both found same file
        if (aiResult.filePath === quickResult.filePath) {
            result.confidence = (quickResult.confidence + aiResult.confidence) / 2;
        }

        return result;
    }

    /**
     * Merge quick parse and AI results
     * @param {object} quickResult - Quick parse result
     * @param {object} aiResult - AI analysis result
     * @returns {object} Merged result
     */
    mergeResults(quickResult, aiResult) {
        // If AI failed, use quick parse
        if (!aiResult || aiResult.source === 'ai_analysis_failed') {
            return { ...quickResult, merged: false };
        }

        // If quick parse found nothing, use AI
        if (!quickResult.filePath && aiResult.filePath) {
            return { ...aiResult, merged: false };
        }

        // If both found the same file, boost confidence
        if (quickResult.filePath && aiResult.filePath &&
            this.normalizePath(quickResult.filePath) === this.normalizePath(aiResult.filePath)) {
            return {
                filePath: quickResult.filePath,
                lineNumber: aiResult.lineNumber || quickResult.lineNumber,
                column: quickResult.column,
                errorType: aiResult.errorType || quickResult.errorType,
                errorMessage: aiResult.errorMessage || quickResult.errorMessage,
                confidence: Math.min((quickResult.confidence + aiResult.confidence) / 2 + 0.1, 0.98),
                language: aiResult.language,
                source: 'merged',
                merged: true,
                additionalContext: aiResult.additionalContext,
            };
        }

        // Different results - go with higher confidence
        if (aiResult.confidence > quickResult.confidence) {
            return { ...aiResult, merged: false };
        }

        return { ...quickResult, merged: false };
    }

    /**
     * Normalize path for comparison
     * @param {string} path - File path
     * @param {string} repoName - Repository name for stripping prefixes
     * @returns {string} Normalized path
     */
    normalizePath(path, repoName = null) {
        if (!path) return '';

        let normalized = path
            .replace(/\\/g, '/')  // Convert backslashes to forward slashes
            .replace(/^\/+/, '') // Remove leading slashes
            .trim();

        // Remove GitHub Actions runner path prefixes
        const runnerPatterns = [
            /^\/home\/runner\/work\/[^/]+\/[^/]+\//i,
            /^home\/runner\/work\/[^/]+\/[^/]+\//i,
            /^\/github\/workspace\//i,
            /^D:\/a\/[^/]+\/[^/]+\//i,
            /^C:\/actions-runner\/_work\/[^/]+\/[^/]+\//i,
        ];

        for (const pattern of runnerPatterns) {
            normalized = normalized.replace(pattern, '');
        }

        // Remove duplicate repo name prefixes like "repo-name/repo-name/src"
        const duplicatePattern = /^([^/]+)\/\1\//;
        if (duplicatePattern.test(normalized)) {
            normalized = normalized.replace(duplicatePattern, '');
        }

        // Ensure we have a relative path
        normalized = normalized.replace(/^\/+/, '');

        return normalized;
    }

    /**
     * Extract summary for logging/display
     * @param {object} result - Scout result
     * @returns {string} Human-readable summary
     */
    getSummary(result) {
        if (!result.filePath) {
            return 'Could not identify the failing file';
        }

        let summary = `Found error in ${result.filePath}`;
        if (result.lineNumber) {
            summary += ` at line ${result.lineNumber}`;
        }
        if (result.errorType) {
            summary += `: ${result.errorType}`;
        }
        summary += ` (${(result.confidence * 100).toFixed(0)}% confidence)`;

        return summary;
    }
}

// Export singleton instance
export const scout = new ScoutAgent();

export default scout;
