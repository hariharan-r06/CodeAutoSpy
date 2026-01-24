/**
 * Error Parser
 * Parses different error formats from various languages and build systems
 */

import logger from './logger.js';

/**
 * Error pattern definitions for different languages
 */
const errorPatterns = {
    // Python error patterns
    python: [
        // Standard Python traceback
        {
            pattern: /File "([^"]+)", line (\d+)(?:, in [\w<>]+)?\n\s+.*\n(\w+Error): (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                errorType: match[3],
                errorMessage: match[4],
            }),
        },
        // SyntaxError with caret
        {
            pattern: /File "([^"]+)", line (\d+)\n\s+.*\n\s+\^\nSyntaxError: (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                errorType: 'SyntaxError',
                errorMessage: match[3],
            }),
        },
        // IndentationError
        {
            pattern: /File "([^"]+)", line (\d+)\n\s+.*\n(?:.*\n)?IndentationError: (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                errorType: 'IndentationError',
                errorMessage: match[3],
            }),
        },
        // ModuleNotFoundError
        {
            pattern: /ModuleNotFoundError: No module named '([^']+)'/g,
            extract: (match) => ({
                filePath: null,
                lineNumber: null,
                errorType: 'ModuleNotFoundError',
                errorMessage: `No module named '${match[1]}'`,
                moduleName: match[1],
            }),
        },
    ],

    // JavaScript/Node.js error patterns
    javascript: [
        // Standard Node.js error with file:line:column
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.(?:js|jsx|mjs|cjs)):(\d+)(?::(\d+))?\n(.*)\n\s*\^\s*\n(\w+): (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: match[3] ? parseInt(match[3], 10) : null,
                errorType: match[5],
                errorMessage: match[6],
            }),
        },
        // Module not found
        {
            pattern: /Error: Cannot find module '([^']+)'[\s\S]*?Require stack:\s*([\s\S]*?)(?:\n\n|\nat )/g,
            extract: (match) => {
                const stack = match[2].trim().split('\n');
                const firstFile = stack[0]?.replace(/^- /, '').trim();
                return {
                    filePath: firstFile,
                    lineNumber: null,
                    errorType: 'ModuleNotFoundError',
                    errorMessage: `Cannot find module '${match[1]}'`,
                    missingModule: match[1],
                };
            },
        },
        // ESLint errors
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.(?:js|jsx|ts|tsx))\s*\n\s*(\d+):(\d+)\s+error\s+(.+?)\s+([\w\/-]+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: 'ESLintError',
                errorMessage: match[4],
                rule: match[5],
            }),
        },
        // Webpack/Build errors
        {
            pattern: /ERROR in ([\/\\][\w\/\\\-_.]+\.(?:js|jsx|ts|tsx))\s*\n.*?(\d+):(\d+).*?\n(.*)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: 'BuildError',
                errorMessage: match[4],
            }),
        },
    ],

    // TypeScript error patterns
    typescript: [
        // TSC error format: file(line,col): error TSxxxx: message
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.tsx?)\((\d+),(\d+)\): error (TS\d+): (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: match[4],
                errorMessage: match[5],
            }),
        },
        // TSC error format: file:line:col - error TSxxxx: message
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.tsx?):(\d+):(\d+) - error (TS\d+): (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: match[4],
                errorMessage: match[5],
            }),
        },
    ],

    // Java error patterns
    java: [
        // Javac compilation error
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.java):(\d+): error: (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                errorType: 'CompilationError',
                errorMessage: match[3],
            }),
        },
        // Maven/Gradle build error
        {
            pattern: /\[ERROR\] ([\/\\][\w\/\\\-_.]+\.java):\[(\d+),(\d+)\] (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: 'BuildError',
                errorMessage: match[4],
            }),
        },
        // Runtime exception with stack trace
        {
            pattern: /([\w.]+(?:Exception|Error)): (.+)\n\s+at (?:[\w.$]+)\(([^:]+):(\d+)\)/g,
            extract: (match) => ({
                filePath: match[3],
                lineNumber: parseInt(match[4], 10),
                errorType: match[1],
                errorMessage: match[2],
            }),
        },
    ],

    // C/C++ error patterns
    c: [
        // GCC/Clang error format
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.(?:c|h|cpp|hpp|cc)):(\d+):(\d+): error: (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: 'CompilationError',
                errorMessage: match[4],
            }),
        },
        // Linker error
        {
            pattern: /undefined reference to [`']([^'`]+)[`']/g,
            extract: (match) => ({
                filePath: null,
                lineNumber: null,
                errorType: 'LinkerError',
                errorMessage: `undefined reference to '${match[1]}'`,
                missingSymbol: match[1],
            }),
        },
    ],

    // Go error patterns
    go: [
        // Go compiler error
        {
            pattern: /([\/\\][\w\/\\\-_.]+\.go):(\d+):(\d+): (.+)/g,
            extract: (match) => ({
                filePath: match[1],
                lineNumber: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                errorType: 'CompilationError',
                errorMessage: match[4],
            }),
        },
    ],

    // Rust error patterns
    rust: [
        // Rust compiler error
        {
            pattern: /error\[(E\d+)\]: (.+)\n\s+--> ([\/\\][\w\/\\\-_.]+\.rs):(\d+):(\d+)/g,
            extract: (match) => ({
                filePath: match[3],
                lineNumber: parseInt(match[4], 10),
                column: parseInt(match[5], 10),
                errorType: match[1],
                errorMessage: match[2],
            }),
        },
    ],

    // Dockerfile error patterns
    dockerfile: [
        // Docker build error
        {
            pattern: /Step (\d+)\/\d+ : (.+)\n.*?---> Running in [\w]+\n([\s\S]*?)The command.*returned a non-zero code/g,
            extract: (match) => ({
                filePath: 'Dockerfile',
                lineNumber: parseInt(match[1], 10),
                errorType: 'DockerBuildError',
                errorMessage: `Command '${match[2]}' failed`,
                dockerStep: match[2],
                output: match[3].trim(),
            }),
        },
        // COPY failed
        {
            pattern: /COPY failed: ([^\n]+)/g,
            extract: (match) => ({
                filePath: 'Dockerfile',
                lineNumber: null,
                errorType: 'DockerCopyError',
                errorMessage: `COPY failed: ${match[1]}`,
            }),
        },
    ],
};

/**
 * Generic patterns that work across languages
 */
const genericPatterns = [
    // Generic file:line:column format
    {
        pattern: /([\/\\][\w\/\\\-_.]+\.\w+):(\d+)(?::(\d+))?(?:\s*[-:]?\s*|\s+)(?:error|Error|ERROR)[:\s]+(.+)/g,
        extract: (match) => ({
            filePath: match[1],
            lineNumber: parseInt(match[2], 10),
            column: match[3] ? parseInt(match[3], 10) : null,
            errorType: 'Error',
            errorMessage: match[4],
        }),
    },
    // GitHub Actions annotation format
    {
        pattern: /::error file=([^,]+),line=(\d+)(?:,col=(\d+))?::(.+)/g,
        extract: (match) => ({
            filePath: match[1],
            lineNumber: parseInt(match[2], 10),
            column: match[3] ? parseInt(match[3], 10) : null,
            errorType: 'AnnotationError',
            errorMessage: match[4],
        }),
    },
];

/**
 * Parse errors from build log using language-specific patterns
 * @param {string} log - Build log content
 * @param {string} language - Detected language (optional)
 * @returns {Array<object>} Array of parsed errors
 */
export function parseErrors(log, language = null) {
    const errors = [];
    const seen = new Set();

    // Get patterns to use
    let patterns = [...genericPatterns];

    if (language && errorPatterns[language]) {
        patterns = [...errorPatterns[language], ...patterns];
    } else {
        // Try all language patterns
        for (const langPatterns of Object.values(errorPatterns)) {
            patterns = [...langPatterns, ...patterns];
        }
    }

    // Extract errors using each pattern
    for (const { pattern, extract } of patterns) {
        // Reset pattern's lastIndex for global regex
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(log)) !== null) {
            try {
                const error = extract(match);

                // Create unique key to avoid duplicates
                const key = `${error.filePath}:${error.lineNumber}:${error.errorType}`;

                if (!seen.has(key)) {
                    seen.add(key);
                    errors.push({
                        ...error,
                        rawMatch: match[0],
                        matchIndex: match.index,
                    });
                }
            } catch (e) {
                logger.warn('Error extracting from match', { error: e.message });
            }
        }
    }

    // Sort by relevance (errors with file paths first, then by position in log)
    errors.sort((a, b) => {
        if (a.filePath && !b.filePath) return -1;
        if (!a.filePath && b.filePath) return 1;
        return a.matchIndex - b.matchIndex;
    });

    return errors;
}

/**
 * Extract the most relevant error from a build log
 * @param {string} log - Build log content
 * @param {string} language - Detected language (optional)
 * @returns {object|null} Most relevant error or null
 */
export function findPrimaryError(log, language = null) {
    const errors = parseErrors(log, language);

    if (errors.length === 0) return null;

    // Prioritize errors with file paths and line numbers
    const withLocation = errors.filter(e => e.filePath && e.lineNumber);
    if (withLocation.length > 0) {
        return withLocation[0];
    }

    // Return first error if no location info available
    return errors[0];
}

/**
 * Extract relevant log section around an error
 * @param {string} log - Full build log
 * @param {number} errorIndex - Index of error in log
 * @param {number} contextLines - Number of lines of context
 * @returns {string} Relevant log section
 */
export function extractLogContext(log, errorIndex, contextLines = 10) {
    const lines = log.split('\n');
    const targetLine = log.substring(0, errorIndex).split('\n').length - 1;

    const startLine = Math.max(0, targetLine - contextLines);
    const endLine = Math.min(lines.length, targetLine + contextLines + 1);

    return lines.slice(startLine, endLine).join('\n');
}

/**
 * Clean and normalize file paths from logs
 * @param {string} filePath - Raw file path from log
 * @returns {string} Normalized file path
 */
export function normalizeFilePath(filePath) {
    if (!filePath) return null;

    // Remove common build directory prefixes
    const prefixes = [
        '/github/workspace/',
        '/home/runner/work/',
        '/app/',
        '/src/',
        'src/',
    ];

    let normalized = filePath;

    for (const prefix of prefixes) {
        if (normalized.startsWith(prefix)) {
            normalized = normalized.substring(prefix.length);
            break;
        }
    }

    // Normalize path separators
    normalized = normalized.replace(/\\/g, '/');

    // Remove leading slashes
    normalized = normalized.replace(/^\/+/, '');

    return normalized;
}

/**
 * Categorize error type for better handling
 * @param {string} errorType - Error type string
 * @returns {string} Error category
 */
export function categorizeError(errorType) {
    const categories = {
        syntax: ['SyntaxError', 'IndentationError', 'ParseError'],
        import: ['ModuleNotFoundError', 'ImportError', 'ModuleNotFound'],
        type: ['TypeError', 'TS2304', 'TS2322', 'TS2339'],
        reference: ['ReferenceError', 'NameError', 'undefined reference'],
        runtime: ['NullPointerException', 'ArrayIndexOutOfBoundsException'],
        build: ['BuildError', 'CompilationError', 'LinkerError'],
        docker: ['DockerBuildError', 'DockerCopyError'],
    };

    for (const [category, types] of Object.entries(categories)) {
        if (types.some(t => errorType?.includes(t))) {
            return category;
        }
    }

    return 'unknown';
}

export default {
    parseErrors,
    findPrimaryError,
    extractLogContext,
    normalizeFilePath,
    categorizeError,
};
