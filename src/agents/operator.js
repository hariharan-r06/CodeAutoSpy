/**
 * Operator Agent
 * Creates Pull Requests and manages GitHub interactions for fixes
 */

import {
    createBranch,
    createOrUpdateFile,
    createPullRequest,
    createIssue,
    getDefaultBranch,
    getFileContent,
} from '../config/github.js';
import { generateContent } from '../config/ai-provider.js';
import { getPRDescriptionPrompt, getIssueBodyPrompt } from '../prompts/analysis-prompt.js';
import logger from '../utils/logger.js';

/**
 * Operator Agent - Manages PR/Issue creation and GitHub operations
 */
class OperatorAgent {
    constructor() {
        this.name = 'Operator';
        this.branchPrefix = 'autopsy/fix';
        this.labels = ['autopsy-fix', 'automated-pr'];
    }

    /**
     * Create a Pull Request with the fix
     * @param {object} params - PR creation parameters
     * @returns {Promise<object>} Created PR data
     */
    async createFixPR({
        owner,
        repo,
        filePath,
        originalCode,
        fixedCode,
        commitSha,
        errorInfo,
        diffSummary,
        runId,
        logsUrl,
    }) {
        const startTime = logger.startOperation('OperatorAgent.createFixPR', {
            owner,
            repo,
            filePath,
        });

        try {
            // Get default branch
            const baseBranch = await getDefaultBranch(owner, repo);

            // Create fix branch name
            const timestamp = Date.now();
            const shortSha = commitSha.substring(0, 7);
            const branchName = `${this.branchPrefix}-${timestamp}-${shortSha}`;

            // Get current file SHA for update
            let fileSha = null;
            try {
                const currentFile = await getFileContent(owner, repo, filePath, baseBranch);
                fileSha = currentFile.sha;
            } catch (error) {
                logger.warn('Could not get current file SHA', { error: error.message });
            }

            // Create the branch
            await createBranch(owner, repo, branchName, commitSha);
            logger.debug('Branch created', { branchName });

            // Commit the fix
            const commitMessage = `[CodeAutopsy] Fix ${errorInfo.errorType} in ${filePath}`;
            await createOrUpdateFile(
                owner,
                repo,
                filePath,
                fixedCode,
                commitMessage,
                branchName,
                fileSha
            );
            logger.debug('Fix committed', { branchName, filePath });

            // Generate PR description
            const prBody = await this.generatePRBody({
                errorInfo,
                filePath,
                diffSummary,
                runId,
                logsUrl,
            });

            // Create the Pull Request
            const prTitle = `[CodeAutopsy] Fix ${errorInfo.errorType} in ${filePath}`;
            const pr = await createPullRequest(
                owner,
                repo,
                prTitle,
                prBody,
                branchName,
                baseBranch,
                this.labels
            );

            const result = {
                success: true,
                prNumber: pr.number,
                prUrl: pr.html_url,
                branchName,
                baseBranch,
                title: prTitle,
            };

            logger.endOperation('OperatorAgent.createFixPR', startTime, {
                prNumber: result.prNumber,
                prUrl: result.prUrl,
            });

            return result;
        } catch (error) {
            logger.failOperation('OperatorAgent.createFixPR', startTime, error);
            throw error;
        }
    }

    /**
     * Create an issue for manual review (low-confidence fixes)
     * @param {object} params - Issue creation parameters
     * @returns {Promise<object>} Created issue data
     */
    async createManualReviewIssue({
        owner,
        repo,
        filePath,
        errorInfo,
        buildLog,
        attemptedFix = null,
        failureReason,
        runId,
        logsUrl,
    }) {
        const startTime = logger.startOperation('OperatorAgent.createManualReviewIssue');

        try {
            // Generate issue body
            const issueBody = await this.generateIssueBody({
                errorInfo,
                filePath,
                buildLog,
                attemptedFix,
                failureReason,
                runId,
                logsUrl,
            });

            const issueTitle = `[CodeAutopsy] Build Failure: ${errorInfo.errorType} in ${filePath}`;

            const issue = await createIssue(
                owner,
                repo,
                issueTitle,
                issueBody,
                ['autopsy-analysis', 'needs-review', 'bug']
            );

            const result = {
                success: true,
                issueNumber: issue.number,
                issueUrl: issue.html_url,
                title: issueTitle,
            };

            logger.endOperation('OperatorAgent.createManualReviewIssue', startTime, {
                issueNumber: result.issueNumber,
            });

            return result;
        } catch (error) {
            logger.failOperation('OperatorAgent.createManualReviewIssue', startTime, error);
            throw error;
        }
    }

    /**
     * Generate PR body using AI
     * @param {object} params - Generation parameters
     * @returns {Promise<string>} PR body markdown
     */
    async generatePRBody({ errorInfo, filePath, diffSummary, runId, logsUrl }) {
        try {
            const prompt = getPRDescriptionPrompt({
                originalError: errorInfo,
                fixApplied: diffSummary,
                filePath,
                diffSummary,
                runId,
                logsUrl,
            });

            const { text } = await generateContent(prompt, 'FLASH');
            return text.trim();
        } catch (error) {
            logger.warn('AI PR body generation failed, using template', { error: error.message });
            return this.getTemplatePRBody({ errorInfo, filePath, diffSummary, runId, logsUrl });
        }
    }

    /**
     * Template PR body (fallback)
     * @param {object} params - Template parameters
     * @returns {string} PR body markdown
     */
    getTemplatePRBody({ errorInfo, filePath, diffSummary, runId, logsUrl }) {
        return `## 🤖 CodeAutopsy Auto-Fix

**Build Failure Detected:** [#${runId}](${logsUrl})

### 📋 Diagnosis
- **File:** \`${filePath}\`
- **Error:** ${errorInfo.errorType}${errorInfo.lineNumber ? ` at line ${errorInfo.lineNumber}` : ''}
- **Issue:** ${errorInfo.errorMessage}

### 🔧 Applied Fix
\`\`\`
${diffSummary}
\`\`\`

### ⚠️ Review Required
This is an automated fix generated by AI. Please review carefully before merging:

- [ ] Verify the fix addresses the original error
- [ ] Check for any unintended side effects
- [ ] Ensure code style is consistent
- [ ] Run tests to confirm the fix works

### 📊 Confidence Score
**${(errorInfo.confidence * 100 || 85).toFixed(0)}%** - ${this.getConfidenceLabel(errorInfo.confidence || 0.85)}

---
*Generated by [CodeAutopsy](https://github.com/codeautopsy) AI Agent* 🔬`;
    }

    /**
     * Generate issue body using AI
     * @param {object} params - Generation parameters
     * @returns {Promise<string>} Issue body markdown
     */
    async generateIssueBody({
        errorInfo,
        filePath,
        buildLog,
        attemptedFix,
        failureReason,
        runId,
        logsUrl,
    }) {
        try {
            // Truncate build log for prompt
            const truncatedLog = buildLog.length > 2000
                ? buildLog.substring(buildLog.length - 2000)
                : buildLog;

            const prompt = getIssueBodyPrompt({
                originalError: errorInfo,
                filePath,
                buildLog: truncatedLog,
                attemptedFix,
                failureReason,
            });

            const { text } = await generateContent(prompt, 'FLASH');

            // Add header and footer
            return `## 🔍 CodeAutopsy Analysis

**Build Run:** [#${runId}](${logsUrl})

${text.trim()}

---
*This issue was automatically created by [CodeAutopsy](https://github.com/codeautopsy) AI Agent* 🔬`;
        } catch (error) {
            logger.warn('AI issue body generation failed, using template', { error: error.message });
            return this.getTemplateIssueBody({
                errorInfo,
                filePath,
                buildLog,
                failureReason,
                runId,
                logsUrl,
            });
        }
    }

    /**
     * Template issue body (fallback)
     * @param {object} params - Template parameters
     * @returns {string} Issue body markdown
     */
    getTemplateIssueBody({ errorInfo, filePath, buildLog, failureReason, runId, logsUrl }) {
        // Truncate build log for display
        const logExcerpt = buildLog.length > 1000
            ? '...\n' + buildLog.substring(buildLog.length - 1000)
            : buildLog;

        return `## 🔍 CodeAutopsy Analysis

**Build Run:** [#${runId}](${logsUrl})

### 📋 Error Detected
- **File:** \`${filePath}\`
- **Error Type:** ${errorInfo.errorType}
- **Line:** ${errorInfo.lineNumber || 'Unknown'}
- **Message:** ${errorInfo.errorMessage}

### 🚫 Auto-Fix Not Applied
${failureReason}

### 📝 Build Log Excerpt
\`\`\`
${logExcerpt}
\`\`\`

### 💡 Suggested Next Steps
1. Review the error message and build log above
2. Check the file at the indicated line(s)
3. Consider the error type when investigating
4. Run the build locally to reproduce

---
*This issue was automatically created by [CodeAutopsy](https://github.com/codeautopsy) AI Agent* 🔬`;
    }

    /**
     * Get human-readable confidence label
     * @param {number} confidence - Confidence score (0-1)
     * @returns {string} Human-readable label
     */
    getConfidenceLabel(confidence) {
        if (confidence >= 0.9) return 'Very High - This fix is highly likely to work';
        if (confidence >= 0.8) return 'High - Fix should work, review recommended';
        if (confidence >= 0.7) return 'Medium - Please review carefully';
        if (confidence >= 0.5) return 'Low - Extensive review required';
        return 'Very Low - Manual verification essential';
    }

    /**
     * Check if confidence is high enough for auto-PR
     * @param {number} confidence - Confidence score
     * @returns {boolean} Whether to create PR
     */
    shouldCreatePR(confidence) {
        const threshold = parseFloat(process.env.MIN_CONFIDENCE_FOR_PR) || 0.85;
        return confidence >= threshold;
    }

    /**
     * Check if confidence is high enough for issue creation
     * @param {number} confidence - Confidence score
     * @returns {boolean} Whether to create issue
     */
    shouldCreateIssue(confidence) {
        const threshold = parseFloat(process.env.MIN_CONFIDENCE_FOR_ISSUE) || 0.5;
        return confidence >= threshold;
    }

    /**
     * Format commit message for the fix
     * @param {object} errorInfo - Error information
     * @param {string} filePath - File that was fixed
     * @returns {string} Formatted commit message
     */
    formatCommitMessage(errorInfo, filePath) {
        const type = errorInfo.errorType || 'error';
        const shortPath = filePath.split('/').pop();

        let message = `fix(${shortPath}): resolve ${type}`;

        if (errorInfo.lineNumber) {
            message += ` at line ${errorInfo.lineNumber}`;
        }

        message += '\n\n';
        message += `This commit fixes the following error:\n`;
        message += `- Error: ${errorInfo.errorMessage}\n`;
        message += `- File: ${filePath}\n`;
        message += `\nGenerated by CodeAutopsy AI Agent`;

        return message;
    }

    /**
     * Get summary for logging
     * @param {object} result - Operation result
     * @param {string} type - 'pr' or 'issue'
     * @returns {string} Human-readable summary
     */
    getSummary(result, type = 'pr') {
        if (!result.success) {
            return `Failed to create ${type}`;
        }

        if (type === 'pr') {
            return `Created PR #${result.prNumber}: ${result.prUrl}`;
        } else {
            return `Created Issue #${result.issueNumber}: ${result.issueUrl}`;
        }
    }
}

// Export singleton instance
export const operator = new OperatorAgent();

export default operator;
