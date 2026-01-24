/**
 * Language Detector
 * Detects programming language from file extensions, shebangs, and error patterns
 */

// File extension to language mapping
const extensionMap = {
    // JavaScript/TypeScript
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',

    // Python
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',

    // Java
    '.java': 'java',
    '.jar': 'java',
    '.class': 'java',

    // C/C++
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',

    // Go
    '.go': 'go',

    // Rust
    '.rs': 'rust',

    // Ruby
    '.rb': 'ruby',
    '.rake': 'ruby',
    '.gemspec': 'ruby',

    // PHP
    '.php': 'php',

    // Shell
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'zsh',

    // Docker
    'Dockerfile': 'dockerfile',
    '.dockerfile': 'dockerfile',

    // YAML/Config
    '.yml': 'yaml',
    '.yaml': 'yaml',

    // JSON
    '.json': 'json',

    // Kotlin
    '.kt': 'kotlin',
    '.kts': 'kotlin',

    // Swift
    '.swift': 'swift',

    // C#
    '.cs': 'csharp',

    // Scala
    '.scala': 'scala',

    // HTML/CSS
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
};

// Shebang to language mapping
const shebangMap = {
    'python': 'python',
    'python3': 'python',
    'python2': 'python',
    'node': 'javascript',
    'nodejs': 'javascript',
    'ruby': 'ruby',
    'perl': 'perl',
    'php': 'php',
    'bash': 'bash',
    'sh': 'bash',
    'zsh': 'zsh',
};

// Error patterns to language mapping
const errorPatterns = {
    python: [
        /IndentationError/i,
        /SyntaxError.*python/i,
        /ModuleNotFoundError/i,
        /ImportError/i,
        /NameError/i,
        /TypeError.*python/i,
        /AttributeError/i,
        /KeyError/i,
        /ValueError/i,
        /FileNotFoundError/i,
        /pip install/i,
        /requirements\.txt/i,
        /\.py:\d+:/,
        /Traceback \(most recent call last\)/i,
    ],
    javascript: [
        /SyntaxError.*Unexpected token/i,
        /ReferenceError/i,
        /TypeError.*is not a function/i,
        /Module not found/i,
        /Cannot find module/i,
        /npm ERR!/i,
        /yarn error/i,
        /node_modules/i,
        /package\.json/i,
        /\.js:\d+:\d+/,
        /ESLint/i,
    ],
    typescript: [
        /TS\d{4}:/,
        /TypeScript/i,
        /\.ts:\d+:\d+/,
        /type.*is not assignable/i,
        /Property.*does not exist on type/i,
        /tsc/i,
    ],
    java: [
        /ClassNotFoundException/i,
        /NullPointerException/i,
        /ArrayIndexOutOfBoundsException/i,
        /java\.lang\./i,
        /javac/i,
        /\.java:\d+:/,
        /BUILD FAILED/i,
        /gradle/i,
        /maven/i,
        /pom\.xml/i,
    ],
    c: [
        /error:.*\.c:/i,
        /undefined reference to/i,
        /segmentation fault/i,
        /gcc/i,
        /clang/i,
        /make.*Error/i,
        /\.c:\d+:\d+:/,
    ],
    cpp: [
        /error:.*\.cpp:/i,
        /error:.*\.hpp:/i,
        /g\+\+/i,
        /undefined reference to/i,
        /\.cpp:\d+:\d+:/,
        /template.*error/i,
        /CMake Error/i,
    ],
    go: [
        /cannot find package/i,
        /undefined:/i,
        /go build/i,
        /go\.mod/i,
        /\.go:\d+:\d+:/,
    ],
    rust: [
        /error\[E\d{4}\]/i,
        /cargo build/i,
        /rustc/i,
        /\.rs:\d+:\d+:/,
        /Cargo\.toml/i,
    ],
    ruby: [
        /SyntaxError.*ruby/i,
        /NoMethodError/i,
        /NameError.*uninitialized constant/i,
        /bundle install/i,
        /Gemfile/i,
        /\.rb:\d+:/,
    ],
    dockerfile: [
        /COPY failed/i,
        /RUN.*failed/i,
        /docker build/i,
        /Dockerfile/i,
        /FROM.*not found/i,
        /Step \d+\/\d+ :/,
    ],
};

// Language-specific characteristics
export const languageInfo = {
    python: {
        extensions: ['.py'],
        packageFile: 'requirements.txt',
        indentSensitive: true,
        commonErrors: ['IndentationError', 'SyntaxError', 'ModuleNotFoundError', 'ImportError'],
    },
    javascript: {
        extensions: ['.js', '.jsx', '.mjs'],
        packageFile: 'package.json',
        indentSensitive: false,
        commonErrors: ['SyntaxError', 'ReferenceError', 'TypeError', 'Module not found'],
    },
    typescript: {
        extensions: ['.ts', '.tsx'],
        packageFile: 'package.json',
        indentSensitive: false,
        commonErrors: ['TS2304', 'TS2322', 'TS2339', 'TS2345'],
    },
    java: {
        extensions: ['.java'],
        packageFile: 'pom.xml',
        indentSensitive: false,
        commonErrors: ['ClassNotFoundException', 'NullPointerException', 'compilation error'],
    },
    c: {
        extensions: ['.c', '.h'],
        packageFile: 'Makefile',
        indentSensitive: false,
        commonErrors: ['undefined reference', 'segmentation fault', 'syntax error'],
    },
    cpp: {
        extensions: ['.cpp', '.hpp', '.cc'],
        packageFile: 'CMakeLists.txt',
        indentSensitive: false,
        commonErrors: ['undefined reference', 'template error', 'type mismatch'],
    },
    go: {
        extensions: ['.go'],
        packageFile: 'go.mod',
        indentSensitive: false,
        commonErrors: ['cannot find package', 'undefined', 'type mismatch'],
    },
    rust: {
        extensions: ['.rs'],
        packageFile: 'Cargo.toml',
        indentSensitive: false,
        commonErrors: ['E0425', 'E0308', 'borrow checker'],
    },
    dockerfile: {
        extensions: ['Dockerfile', '.dockerfile'],
        packageFile: null,
        indentSensitive: false,
        commonErrors: ['COPY failed', 'RUN failed', 'not found'],
    },
};

/**
 * Detect language from file path
 * @param {string} filePath - Path to the file
 * @returns {string|null} Detected language or null
 */
export function detectFromPath(filePath) {
    if (!filePath) return null;

    // Check for Dockerfile (special case - no extension)
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
    if (fileName === 'Dockerfile' || fileName.toLowerCase().startsWith('dockerfile')) {
        return 'dockerfile';
    }

    // Get file extension
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return null;

    const extension = filePath.substring(lastDot).toLowerCase();
    return extensionMap[extension] || null;
}

/**
 * Detect language from shebang line
 * @param {string} content - File content
 * @returns {string|null} Detected language or null
 */
export function detectFromShebang(content) {
    if (!content) return null;

    const firstLine = content.split('\n')[0];
    if (!firstLine.startsWith('#!')) return null;

    // Extract interpreter from shebang
    const shebang = firstLine.substring(2).trim();

    // Handle /usr/bin/env pattern
    if (shebang.includes('env ')) {
        const interpreter = shebang.split('env ')[1]?.split(/\s/)[0];
        return shebangMap[interpreter] || null;
    }

    // Direct path pattern
    const interpreter = shebang.split('/').pop()?.split(/\s/)[0];
    return shebangMap[interpreter] || null;
}

/**
 * Detect language from error message patterns
 * @param {string} errorLog - Build log or error message
 * @returns {{language: string, confidence: number}|null} Detected language with confidence
 */
export function detectFromErrorLog(errorLog) {
    if (!errorLog) return null;

    const scores = {};

    for (const [language, patterns] of Object.entries(errorPatterns)) {
        let matchCount = 0;

        for (const pattern of patterns) {
            const matches = errorLog.match(pattern);
            if (matches) {
                matchCount += matches.length || 1;
            }
        }

        if (matchCount > 0) {
            scores[language] = matchCount;
        }
    }

    if (Object.keys(scores).length === 0) return null;

    // Find language with highest score
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);

    const [topLanguage, topScore] = entries[0];
    const totalScore = entries.reduce((sum, [, score]) => sum + score, 0);

    return {
        language: topLanguage,
        confidence: topScore / totalScore,
        allMatches: scores,
    };
}

/**
 * Comprehensive language detection
 * @param {object} params - Detection parameters
 * @param {string} params.filePath - File path
 * @param {string} params.content - File content (optional)
 * @param {string} params.errorLog - Error log (optional)
 * @returns {{language: string, confidence: number, source: string}}
 */
export function detectLanguage({ filePath, content, errorLog }) {
    // Try file path first (highest confidence)
    const pathLanguage = detectFromPath(filePath);
    if (pathLanguage) {
        return {
            language: pathLanguage,
            confidence: 0.95,
            source: 'file_extension',
        };
    }

    // Try shebang if content available
    if (content) {
        const shebangLanguage = detectFromShebang(content);
        if (shebangLanguage) {
            return {
                language: shebangLanguage,
                confidence: 0.90,
                source: 'shebang',
            };
        }
    }

    // Try error log patterns
    if (errorLog) {
        const errorResult = detectFromErrorLog(errorLog);
        if (errorResult) {
            return {
                language: errorResult.language,
                confidence: errorResult.confidence * 0.8, // Slightly lower confidence
                source: 'error_patterns',
            };
        }
    }

    return {
        language: 'unknown',
        confidence: 0,
        source: 'none',
    };
}

/**
 * Get language-specific information
 * @param {string} language - Language name
 * @returns {object|null} Language info or null
 */
export function getLanguageInfo(language) {
    return languageInfo[language] || null;
}

export default {
    detectFromPath,
    detectFromShebang,
    detectFromErrorLog,
    detectLanguage,
    getLanguageInfo,
    languageInfo,
};
