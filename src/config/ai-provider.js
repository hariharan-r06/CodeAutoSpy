/**
 * AI Provider Configuration
 * Supports multiple AI providers: OpenRouter, Gemini, Groq
 */

import logger from '../utils/logger.js';

// Get AI provider from environment
const AI_PROVIDER = process.env.AI_PROVIDER || 'openrouter';

// OpenRouter Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Gemini Configuration (fallback)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Model configurations for OpenRouter
export const OpenRouterModels = {
    // Free models on OpenRouter
    FAST: 'google/gemini-2.0-flash-exp:free',       // Fast, free
    PRO: 'google/gemini-2.0-flash-exp:free',        // For complex tasks
    CODE: 'deepseek/deepseek-chat:free',            // Good for code
    LLAMA: 'meta-llama/llama-3.3-70b-instruct:free', // Llama 3.3 70B free
};

/**
 * Generate content using OpenRouter API
 * @param {string} prompt - The prompt to send
 * @param {string} modelType - 'FAST', 'PRO', 'CODE', or 'LLAMA'
 * @returns {Promise<{text: string, usage: object, latency: number}>}
 */
export async function generateContent(prompt, modelType = 'FAST') {
    if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY) {
        // Fall back to Gemini
        const gemini = await import('./gemini.js');
        return gemini.generateContent(prompt, modelType === 'FAST' ? 'FLASH' : 'PRO');
    }

    // Use OpenRouter
    const model = OpenRouterModels[modelType] || OpenRouterModels.FAST;
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const startTime = Date.now();

            const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://codeautospy.local',
                    'X-Title': 'CodeAutoSpy',
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                    temperature: 0.1,
                    max_tokens: 8192,
                }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} - ${errorData}`);
            }

            const data = await response.json();
            const text = data.choices[0]?.message?.content || '';
            const latency = Date.now() - startTime;

            const usage = {
                promptTokens: data.usage?.prompt_tokens || 0,
                responseTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
            };

            logger.debug('OpenRouter response generated', {
                model: model,
                latency: `${latency}ms`,
                tokens: usage.totalTokens,
            });

            return { text, usage, latency };
        } catch (error) {
            lastError = error;

            logger.warn(`OpenRouter API error (attempt ${attempt}/${maxRetries})`, {
                error: error.message,
                model: model,
            });

            // Check if error is retryable
            if (error.message.includes('429') || error.message.includes('5')) {
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * Math.pow(2, attempt))
                );
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Parse JSON from AI response (handles markdown code blocks)
 * @param {string} text - Raw response text
 * @returns {object} Parsed JSON object
 */
export function parseJsonResponse(text) {
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
        logger.error('Failed to parse AI JSON response', {
            error: error.message,
            rawText: text.substring(0, 500),
        });
        throw new Error(`Invalid JSON response: ${error.message}`);
    }
}

/**
 * Extract code from AI response (handles markdown code blocks)
 * @param {string} text - Raw response text
 * @param {string} language - Expected programming language
 * @returns {string} Extracted code
 */
export function extractCodeFromResponse(text, language = '') {
    let cleanText = text.trim();

    // Try to extract code from markdown code block
    const codeBlockRegex = new RegExp(`\`\`\`(?:${language})?\n?([\\s\\S]*?)\`\`\``, 'i');
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

export default {
    generateContent,
    parseJsonResponse,
    extractCodeFromResponse,
    provider: AI_PROVIDER,
};
