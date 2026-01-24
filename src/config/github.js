/**
 * GitHub API Configuration
 * Configures Octokit client for GitHub API interactions
 */

import { Octokit } from 'octokit';
import logger from '../utils/logger.js';

// Initialize Octokit with authentication
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    userAgent: 'CodeAutopsy/1.0.0',
    log: {
        debug: (msg) => logger.debug('Octokit Debug', { message: msg }),
        info: (msg) => logger.debug('Octokit Info', { message: msg }),
        warn: (msg) => logger.warn('Octokit Warning', { message: msg }),
        error: (msg) => logger.error('Octokit Error', { message: msg }),
    },
});

/**
 * Validate GitHub token and permissions
 * @returns {Promise<{valid: boolean, user: string, scopes: string[]}>}
 */
export async function validateToken() {
    try {
        const { data: user } = await octokit.rest.users.getAuthenticated();

        logger.info('GitHub token validated', {
            user: user.login,
            type: user.type,
        });

        return {
            valid: true,
            user: user.login,
            id: user.id,
        };
    } catch (error) {
        logger.error('GitHub token validation failed', {
            error: error.message,
            status: error.status,
        });

        return {
            valid: false,
            error: error.message,
        };
    }
}

/**
 * Get repository information
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<object>} Repository data
 */
export async function getRepository(owner, repo) {
    try {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return data;
    } catch (error) {
        logger.error('Failed to get repository', {
            owner,
            repo,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get file content from repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} path - File path
 * @param {string} ref - Git reference (branch, tag, or SHA)
 * @returns {Promise<{content: string, sha: string, encoding: string}>}
 */
export async function getFileContent(owner, repo, path, ref = 'main') {
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref,
        });

        if (Array.isArray(data)) {
            throw new Error(`Path "${path}" is a directory, not a file`);
        }

        // Decode base64 content
        const content = Buffer.from(data.content, 'base64').toString('utf-8');

        return {
            content,
            sha: data.sha,
            encoding: data.encoding,
            size: data.size,
            path: data.path,
        };
    } catch (error) {
        if (error.status === 404) {
            logger.warn('File not found in repository', { owner, repo, path, ref });
            throw new Error(`File not found: ${path}`);
        }
        throw error;
    }
}

/**
 * Get workflow run logs
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} runId - Workflow run ID
 * @returns {Promise<string>} Raw log content
 */
export async function getWorkflowLogs(owner, repo, runId) {
    try {
        const { data } = await octokit.rest.actions.downloadWorkflowRunLogs({
            owner,
            repo,
            run_id: runId,
        });

        // The data is a zip file, we need to extract it
        // For now, return the raw data
        return data;
    } catch (error) {
        logger.error('Failed to get workflow logs', {
            owner,
            repo,
            runId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get workflow job details
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} jobId - Job ID
 * @returns {Promise<object>} Job details
 */
export async function getWorkflowJob(owner, repo, jobId) {
    try {
        const { data } = await octokit.rest.actions.getJobForWorkflowRun({
            owner,
            repo,
            job_id: jobId,
        });
        return data;
    } catch (error) {
        logger.error('Failed to get workflow job', {
            owner,
            repo,
            jobId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get workflow run details
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} runId - Run ID
 * @returns {Promise<object>} Run details
 */
export async function getWorkflowRun(owner, repo, runId) {
    try {
        const { data } = await octokit.rest.actions.getWorkflowRun({
            owner,
            repo,
            run_id: runId,
        });
        return data;
    } catch (error) {
        logger.error('Failed to get workflow run', {
            owner,
            repo,
            runId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create a new branch
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - New branch name
 * @param {string} baseSha - Base commit SHA
 * @returns {Promise<object>} Created reference
 */
export async function createBranch(owner, repo, branchName, baseSha) {
    try {
        const { data } = await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
        });

        logger.info('Branch created', { owner, repo, branchName });
        return data;
    } catch (error) {
        if (error.status === 422 && error.message.includes('Reference already exists')) {
            logger.warn('Branch already exists', { owner, repo, branchName });
            // Return existing branch info
            const { data } = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: `heads/${branchName}`,
            });
            return data;
        }
        throw error;
    }
}

/**
 * Create or update file in repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} path - File path
 * @param {string} content - File content
 * @param {string} message - Commit message
 * @param {string} branch - Branch name
 * @param {string} sha - Current file SHA (required for updates)
 * @returns {Promise<object>} Commit data
 */
export async function createOrUpdateFile(owner, repo, path, content, message, branch, sha = null) {
    try {
        const params = {
            owner,
            repo,
            path,
            message,
            content: Buffer.from(content).toString('base64'),
            branch,
        };

        if (sha) {
            params.sha = sha;
        }

        const { data } = await octokit.rest.repos.createOrUpdateFileContents(params);

        logger.info('File updated', { owner, repo, path, branch });
        return data;
    } catch (error) {
        logger.error('Failed to update file', {
            owner,
            repo,
            path,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create a pull request
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} title - PR title
 * @param {string} body - PR body
 * @param {string} head - Head branch
 * @param {string} base - Base branch
 * @param {string[]} labels - Labels to add
 * @returns {Promise<object>} Created PR data
 */
export async function createPullRequest(owner, repo, title, body, head, base, labels = []) {
    try {
        // Create the PR
        const { data: pr } = await octokit.rest.pulls.create({
            owner,
            repo,
            title,
            body,
            head,
            base,
        });

        logger.info('Pull request created', {
            owner,
            repo,
            prNumber: pr.number,
            url: pr.html_url,
        });

        // Add labels if provided
        if (labels.length > 0) {
            try {
                await octokit.rest.issues.addLabels({
                    owner,
                    repo,
                    issue_number: pr.number,
                    labels,
                });
            } catch (labelError) {
                logger.warn('Failed to add labels to PR', {
                    prNumber: pr.number,
                    error: labelError.message,
                });
            }
        }

        return pr;
    } catch (error) {
        logger.error('Failed to create pull request', {
            owner,
            repo,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create an issue (for low-confidence fixes)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} title - Issue title
 * @param {string} body - Issue body
 * @param {string[]} labels - Labels to add
 * @returns {Promise<object>} Created issue data
 */
export async function createIssue(owner, repo, title, body, labels = []) {
    try {
        const { data } = await octokit.rest.issues.create({
            owner,
            repo,
            title,
            body,
            labels,
        });

        logger.info('Issue created', {
            owner,
            repo,
            issueNumber: data.number,
            url: data.html_url,
        });

        return data;
    } catch (error) {
        logger.error('Failed to create issue', {
            owner,
            repo,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get the default branch for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<string>} Default branch name
 */
export async function getDefaultBranch(owner, repo) {
    const repoData = await getRepository(owner, repo);
    return repoData.default_branch;
}

/**
 * Get commit details
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @returns {Promise<object>} Commit data
 */
export async function getCommit(owner, repo, sha) {
    try {
        const { data } = await octokit.rest.repos.getCommit({
            owner,
            repo,
            ref: sha,
        });
        return data;
    } catch (error) {
        logger.error('Failed to get commit', {
            owner,
            repo,
            sha,
            error: error.message,
        });
        throw error;
    }
}

export default octokit;
