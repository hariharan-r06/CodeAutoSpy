/**
 * Retriever Agent
 * Fetches source code from GitHub repositories
 */

import {
    getFileContent,
    getDefaultBranch,
    getCommit,
} from '../config/github.js';
import languageDetector from '../utils/language-detector.js';
import logger from '../utils/logger.js';

/**
 * Retriever Agent - Fetches source code and context from repositories
 */
class RetrieverAgent {
    constructor() {
        this.name = 'Retriever';
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute cache
    }

    /**
     * Retrieve a file from a repository
     * @param {object} params - Retrieval parameters
     * @returns {Promise<object>} File content and metadata
     */
    async retrieveFile({
        owner,
        repo,
        filePath,
        ref = null,
        contextLines = 0,
    }) {
        const startTime = logger.startOperation('RetrieverAgent.retrieveFile', {
            owner,
            repo,
            filePath,
        });

        try {
            // Use default branch if no ref specified
            if (!ref) {
                ref = await getDefaultBranch(owner, repo);
            }

            // Check cache
            const cacheKey = `${owner}/${repo}/${filePath}@${ref}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                logger.debug('File retrieved from cache', { cacheKey });
                return cached;
            }

            // Fetch file content
            const fileData = await getFileContent(owner, repo, filePath, ref);

            // Detect language
            const langResult = languageDetector.detectLanguage({
                filePath,
                content: fileData.content,
            });

            const result = {
                content: fileData.content,
                sha: fileData.sha,
                path: fileData.path,
                size: fileData.size,
                encoding: fileData.encoding,
                language: langResult.language,
                languageConfidence: langResult.confidence,
                ref,
                lineCount: fileData.content.split('\n').length,
            };

            // If context lines requested, extract surrounding context
            if (contextLines > 0) {
                result.lines = fileData.content.split('\n');
            }

            // Cache the result
            this.addToCache(cacheKey, result);

            logger.endOperation('RetrieverAgent.retrieveFile', startTime, {
                size: fileData.size,
                language: langResult.language,
            });

            return result;
        } catch (error) {
            logger.failOperation('RetrieverAgent.retrieveFile', startTime, error);
            throw error;
        }
    }

    /**
     * Retrieve file with context around a specific line
     * @param {object} params - Retrieval parameters
     * @returns {Promise<object>} File with context
     */
    async retrieveWithContext({
        owner,
        repo,
        filePath,
        lineNumber,
        ref = null,
        contextBefore = 20,
        contextAfter = 20,
    }) {
        const startTime = logger.startOperation('RetrieverAgent.retrieveWithContext');

        try {
            const file = await this.retrieveFile({ owner, repo, filePath, ref });
            const lines = file.content.split('\n');

            // Calculate context range
            const startLine = Math.max(0, (lineNumber || 1) - 1 - contextBefore);
            const endLine = Math.min(lines.length, (lineNumber || 1) + contextAfter);

            const contextLines = lines.slice(startLine, endLine);
            const targetLineIndex = lineNumber ? lineNumber - 1 - startLine : 0;

            const result = {
                ...file,
                context: {
                    lines: contextLines,
                    startLine: startLine + 1,
                    endLine: endLine,
                    targetLine: lineNumber,
                    targetLineContent: lineNumber ? lines[lineNumber - 1] : null,
                    targetLineIndex,
                },
                formattedContext: this.formatContext(contextLines, startLine + 1, lineNumber),
            };

            logger.endOperation('RetrieverAgent.retrieveWithContext', startTime, {
                linesRetrieved: contextLines.length,
            });

            return result;
        } catch (error) {
            logger.failOperation('RetrieverAgent.retrieveWithContext', startTime, error);
            throw error;
        }
    }

    /**
     * Retrieve multiple files
     * @param {string} owner - Repository owner
     * @param {string} repo - Repository name
     * @param {string[]} filePaths - Array of file paths
     * @param {string} ref - Git reference
     * @returns {Promise<object[]>} Array of file contents
     */
    async retrieveMultiple(owner, repo, filePaths, ref = null) {
        const results = await Promise.allSettled(
            filePaths.map(filePath =>
                this.retrieveFile({ owner, repo, filePath, ref })
            )
        );

        return results.map((result, index) => ({
            path: filePaths[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : null,
        }));
    }

    /**
     * Retrieve related files (imports, package files, etc.)
     * @param {object} params - Retrieval parameters
     * @returns {Promise<object>} Main file and related files
     */
    async retrieveWithRelated({
        owner,
        repo,
        filePath,
        ref = null,
        includePackageFile = true,
        maxRelatedFiles = 5,
    }) {
        const startTime = logger.startOperation('RetrieverAgent.retrieveWithRelated');

        try {
            // Get main file
            const mainFile = await this.retrieveFile({ owner, repo, filePath, ref });

            // Collect related file paths
            const relatedPaths = new Set();

            // Find imports in the file
            const imports = this.extractImports(mainFile.content, mainFile.language);

            // Resolve relative imports to file paths
            for (const imp of imports) {
                if (imp.isRelative) {
                    const resolvedPath = this.resolveRelativePath(filePath, imp.path);
                    if (resolvedPath) {
                        relatedPaths.add(resolvedPath);
                    }
                }
            }

            // Add language-specific package file
            if (includePackageFile) {
                const packageFile = this.getPackageFilePath(mainFile.language, filePath);
                if (packageFile) {
                    relatedPaths.add(packageFile);
                }
            }

            // Fetch related files (limit to prevent excessive API calls)
            const pathsToFetch = Array.from(relatedPaths).slice(0, maxRelatedFiles);
            const relatedFiles = await this.retrieveMultiple(owner, repo, pathsToFetch, ref);

            const result = {
                mainFile,
                imports,
                relatedFiles: relatedFiles.filter(f => f.success),
                failedFiles: relatedFiles.filter(f => !f.success),
            };

            logger.endOperation('RetrieverAgent.retrieveWithRelated', startTime, {
                relatedCount: result.relatedFiles.length,
            });

            return result;
        } catch (error) {
            logger.failOperation('RetrieverAgent.retrieveWithRelated', startTime, error);
            throw error;
        }
    }

    /**
     * Get commit information
     * @param {string} owner - Repository owner
     * @param {string} repo - Repository name
     * @param {string} sha - Commit SHA
     * @returns {Promise<object>} Commit details
     */
    async getCommitInfo(owner, repo, sha) {
        try {
            const commit = await getCommit(owner, repo, sha);
            return {
                sha: commit.sha,
                message: commit.commit.message,
                author: commit.commit.author?.name,
                authorEmail: commit.commit.author?.email,
                date: commit.commit.author?.date,
                files: commit.files?.map(f => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                })),
            };
        } catch (error) {
            logger.error('Failed to get commit info', { owner, repo, sha, error: error.message });
            throw error;
        }
    }

    /**
     * Extract imports from file content
     * @param {string} content - File content
     * @param {string} language - Programming language
     * @returns {Array<object>} Array of import info
     */
    extractImports(content, language) {
        const imports = [];

        const patterns = {
            javascript: [
                // ES6 imports
                /import\s+(?:(?:\{[^}]+\})|(?:\*\s+as\s+\w+)|(?:\w+))?\s*(?:,\s*(?:\{[^}]+\}|\w+))?\s*from\s*['"]([^'"]+)['"]/g,
                // require
                /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            ],
            typescript: [
                /import\s+(?:type\s+)?(?:(?:\{[^}]+\})|(?:\*\s+as\s+\w+)|(?:\w+))?\s*(?:,\s*(?:\{[^}]+\}|\w+))?\s*from\s*['"]([^'"]+)['"]/g,
                /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            ],
            python: [
                /^\s*import\s+([\w.]+)/gm,
                /^\s*from\s+([\w.]+)\s+import/gm,
            ],
            java: [
                /^\s*import\s+([\w.]+);/gm,
            ],
            go: [
                /import\s+(?:\(\s*)?["']([^"']+)["']\s*(?:\))?/g,
            ],
        };

        const langPatterns = patterns[language] || [];

        for (const pattern of langPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const importPath = match[1];
                imports.push({
                    path: importPath,
                    isRelative: importPath.startsWith('.') || importPath.startsWith('/'),
                    raw: match[0],
                });
            }
        }

        return imports;
    }

    /**
     * Resolve relative import path
     * @param {string} currentFile - Current file path
     * @param {string} importPath - Import path
     * @returns {string|null} Resolved file path
     */
    resolveRelativePath(currentFile, importPath) {
        if (!importPath.startsWith('.')) return null;

        const currentDir = currentFile.split('/').slice(0, -1).join('/');
        const parts = `${currentDir}/${importPath}`.split('/').filter(Boolean);

        const resolved = [];
        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            } else if (part !== '.') {
                resolved.push(part);
            }
        }

        let resolvedPath = resolved.join('/');

        // Add common extensions if not present
        if (!resolvedPath.match(/\.\w+$/)) {
            // Check for common extensions
            return resolvedPath + '.js'; // Default to .js, could be smarter
        }

        return resolvedPath;
    }

    /**
     * Get package file path for language
     * @param {string} language - Programming language
     * @param {string} filePath - Current file path
     * @returns {string|null} Package file path
     */
    getPackageFilePath(language, filePath) {
        const packageFiles = {
            javascript: 'package.json',
            typescript: 'package.json',
            python: 'requirements.txt',
            java: 'pom.xml',
            go: 'go.mod',
            rust: 'Cargo.toml',
            ruby: 'Gemfile',
        };

        return packageFiles[language] || null;
    }

    /**
     * Format context with line numbers
     * @param {string[]} lines - Array of lines
     * @param {number} startLine - Starting line number
     * @param {number} highlightLine - Line to highlight
     * @returns {string} Formatted context
     */
    formatContext(lines, startLine, highlightLine = null) {
        const maxLineNumWidth = String(startLine + lines.length).length;

        return lines.map((line, index) => {
            const lineNum = startLine + index;
            const lineNumStr = String(lineNum).padStart(maxLineNumWidth, ' ');
            const marker = lineNum === highlightLine ? '> ' : '  ';
            return `${marker}${lineNumStr} | ${line}`;
        }).join('\n');
    }

    /**
     * Get from cache
     * @param {string} key - Cache key
     * @returns {object|null} Cached value or null
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
            return null;
        }

        return cached.value;
    }

    /**
     * Add to cache
     * @param {string} key - Cache key
     * @param {object} value - Value to cache
     */
    addToCache(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });

        // Clean old entries periodically
        if (this.cache.size > 100) {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.timestamp > this.cacheTimeout) {
                    this.cache.delete(k);
                }
            }
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        logger.debug('RetrieverAgent cache cleared');
    }
}

// Export singleton instance
export const retriever = new RetrieverAgent();

export default retriever;
