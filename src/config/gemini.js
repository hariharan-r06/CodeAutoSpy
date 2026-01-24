/**
 * Gemini AI Configuration
 * Configures Google Generative AI client for code analysis and fixing
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import logger from '../utils/logger.js';

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Safety settings - minimal blocking for code analysis
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

// Model configurations
export const ModelConfig = {
    // Fast model for log analysis and file detection
    FLASH: {
        name: 'gemini-2.5-flash',
        config: {
            temperature: 0.1,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
        },
    },
    // Pro model for complex code fixes
    PRO: {
        name: 'gemini-2.5-flash',
        config: {
            temperature: 0.2,
            topP: 0.9,
            topK: 50,
            maxOutputTokens: 32768,
        },
    },
};

/**
 * Get a configured Gemini model instance
 * @param {string} modelType - 'FLASH' or 'PRO'
 * @returns {GenerativeModel} Configured model instance
 */
export function getModel(modelType = 'FLASH') {
    const modelConfig = ModelConfig[modelType];

    if (!modelConfig) {
        throw new Error(`Unknown model type: ${modelType}. Use 'FLASH' or 'PRO'.`);
    }

    return genAI.getGenerativeModel({
        model: modelConfig.name,
        safetySettings,
        generationConfig: modelConfig.config,
    });
}

/**
 * Generate content with retry logic and error handling
 * @param {string} prompt - The prompt to send to Gemini
 * @param {string} modelType - 'FLASH' or 'PRO'
 * @returns {Promise<{text: string, usage: object}>} Response text and token usage
 */
export async function generateContent(prompt, modelType = 'FLASH') {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const startTime = Date.now();
            const model = getModel(modelType);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            const latency = Date.now() - startTime;

            // Extract token usage if available
            const usage = {
                promptTokens: response.usageMetadata?.promptTokenCount || 0,
                responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
                totalTokens: response.usageMetadata?.totalTokenCount || 0,
            };

            logger.debug('Gemini response generated', {
                model: ModelConfig[modelType].name,
                latency: `${latency}ms`,
                tokens: usage.totalTokens,
            });

            return { text, usage, latency };
        } catch (error) {
            lastError = error;

            logger.warn(`Gemini API error (attempt ${attempt}/${maxRetries})`, {
                error: error.message,
                model: modelType,
            });

            // Check if error is retryable
            if (error.status === 429 || error.status >= 500) {
                // Rate limit or server error - wait before retry
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * Math.pow(2, attempt))
                );
                continue;
            }

            // Non-retryable error
            throw error;
        }
    }

    throw lastError;
}

/**
 * Parse JSON from Gemini response (handles markdown code blocks)
 * @param {string} text - Raw response text
 * @returns {object} Parsed JSON object
 */
export function parseJsonResponse(text) {
    // Remove markdown code blocks if present
    let cleanText = text.trim();

    // Handle ```json ... ``` format
    if (cleanText.startsWith('```json')) {
        cleanText = cleanText.slice(7);
    } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.slice(3);
    }

    if (cleanText.endsWith('```')) {
        cleanText = cleanText.slice(0, -3);
    }

    cleanText = cleanText.trim();

    try {
        return JSON.parse(cleanText);
    } catch (error) {
        logger.error('Failed to parse Gemini JSON response', {
            error: error.message,
            rawText: text.substring(0, 500),
        });
        throw new Error(`Invalid JSON response from Gemini: ${error.message}`);
    }
}

/**
 * Extract code from Gemini response (handles markdown code blocks)
 * @param {string} text - Raw response text
 * @param {string} language - Expected programming language
 * @returns {string} Extracted code
 */
export function extractCodeFromResponse(text, language = '') {
    let cleanText = text.trim();

    // Try to extract code from markdown code block
    const codeBlockRegex = new RegExp(`\`\`\`(?:${language})?\\n?([\\s\\S]*?)\`\`\``, 'i');
    const match = cleanText.match(codeBlockRegex);

    if (match) {
        return match[1].trim();
    }

    // If no code block, try generic extraction
    const genericMatch = cleanText.match(/```[\w]*\n?([\s\S]*?)```/);
    if (genericMatch) {
        return genericMatch[1].trim();
    }

    // Return as-is if no code blocks found
    return cleanText;
}

export default genAI;
