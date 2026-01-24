/**
 * Analysis Prompts
 * Prompts for root cause analysis and detailed diagnostics
 */

/**
 * Generate prompt for root cause analysis
 * @param {object} params - Analysis parameters
 * @returns {string} The formatted prompt
 */
export function getRootCausePrompt({
    buildLog,
    fileContents,
    errorType,
    recentCommits = [],
}) {
    const commitsSection = recentCommits.length > 0
        ? `## Recent Commits
${recentCommits.map(c => `- ${c.sha.substring(0, 7)}: ${c.message}`).join('\n')}`
        : '';

    const filesSection = fileContents && fileContents.length > 0
        ? `## Affected Files
${fileContents.map(f => `
### ${f.path}
\`\`\`
${f.content}
\`\`\`
`).join('\n')}`
        : '';

    return `You are a senior software engineer performing root cause analysis on a CI/CD failure.

## Build Log
\`\`\`
${buildLog}
\`\`\`
${filesSection}
${commitsSection}

## Task
Perform a comprehensive root cause analysis:

1. **Immediate Cause**: What triggered the failure?
2. **Root Cause**: What underlying issue led to this?
3. **Contributing Factors**: What made this error possible?
4. **Prevention**: How could this be prevented in the future?

## Response Format
\`\`\`json
{
  "immediateCause": {
    "description": "Missing semicolon causing syntax error",
    "file": "src/app.js",
    "line": 42
  },
  "rootCause": {
    "description": "Incomplete code review, editor without linting",
    "category": "process" | "tooling" | "knowledge" | "environment"
  },
  "contributingFactors": [
    "No pre-commit hooks configured",
    "ESLint not running in CI"
  ],
  "prevention": [
    "Add pre-commit hooks with lint-staged",
    "Add ESLint step before build in CI"
  ],
  "severity": "low" | "medium" | "high" | "critical",
  "estimatedFixTime": "5 minutes",
  "confidence": 0.90
}
\`\`\``;
}

/**
 * Generate prompt for failure pattern matching
 * @param {object} currentFailure - Current failure details
 * @param {Array} historicalPatterns - Previous similar failures
 * @returns {string} The formatted prompt
 */
export function getPatternMatchPrompt(currentFailure, historicalPatterns) {
    return `You are analyzing a CI/CD failure to find matching patterns from history.

## Current Failure
- **Error Type:** ${currentFailure.errorType}
- **File:** ${currentFailure.filePath}
- **Message:** ${currentFailure.errorMessage}
- **Language:** ${currentFailure.language}

## Historical Patterns (Successfully Fixed)
${historicalPatterns.map((p, i) => `
### Pattern ${i + 1}
- Error: ${p.errorType}
- Pattern: ${p.errorPattern}
- Fix Applied: ${p.fixPattern}
- Success Rate: ${(p.successRate * 100).toFixed(0)}%
`).join('\n')}

## Task
Determine if any historical pattern matches the current failure and could be applied.

## Response Format
\`\`\`json
{
  "matchFound": true,
  "matchingPatternIndex": 0,
  "matchConfidence": 0.92,
  "suggestedFix": "Apply the same fix pattern as the historical case",
  "adaptations": ["Change variable names", "Adjust indentation"],
  "shouldUseHistoricalFix": true
}
\`\`\``;
}

/**
 * Generate prompt for PR description
 * @param {object} params - PR generation parameters
 * @returns {string} The formatted prompt
 */
export function getPRDescriptionPrompt({
    originalError,
    fixApplied,
    filePath,
    diffSummary,
    runId,
    logsUrl,
}) {
    return `Generate a professional, clear Pull Request description for an automated fix.

## Error Information
- **File:** ${filePath}
- **Error Type:** ${originalError.errorType}
- **Error Message:** ${originalError.errorMessage}
- **Build Run:** #${runId}

## Fix Applied
${diffSummary}

## Task
Create a PR description that is:
1. Clear and concise
2. Professional in tone
3. Includes all relevant context
4. Warns reviewers appropriately

## Response Format
Return a markdown-formatted PR body (just the content, no JSON wrapper):`;
}

/**
 * Generate prompt for confidence scoring
 * @param {object} params - Scoring parameters
 * @returns {string} The formatted prompt
 */
export function getConfidencePrompt({
    originalCode,
    fixedCode,
    errorType,
    language,
    diffLineCount,
}) {
    return `Evaluate the confidence level of an automated code fix.

## Context
- **Language:** ${language}
- **Error Type:** ${errorType}
- **Lines Changed:** ${diffLineCount}

## Original Code
\`\`\`${language}
${originalCode}
\`\`\`

## Fixed Code
\`\`\`${language}
${fixedCode}
\`\`\`

## Evaluation Criteria
Rate each factor from 0.0 to 1.0:

1. **Correctness**: Does the fix address the stated error?
2. **Minimality**: Are only necessary changes made?
3. **Safety**: Could this break other functionality?
4. **Style**: Does the fix match existing code style?
5. **Completeness**: Is the fix complete or partial?

## Response Format
\`\`\`json
{
  "correctness": 0.95,
  "minimality": 0.90,
  "safety": 0.85,
  "style": 0.95,
  "completeness": 1.0,
  "overallConfidence": 0.92,
  "concerns": ["The fix modifies a frequently-used function"],
  "recommendation": "proceed" | "review" | "reject"
}
\`\`\``;
}

/**
 * Generate prompt for issue creation (low-confidence cases)
 * @param {object} params - Issue parameters
 * @returns {string} The formatted prompt
 */
export function getIssueBodyPrompt({
    originalError,
    filePath,
    buildLog,
    attemptedFix,
    failureReason,
}) {
    return `Generate a GitHub issue body for a CI/CD failure that couldn't be auto-fixed.

## Failure Details
- **File:** ${filePath}
- **Error Type:** ${originalError.errorType}
- **Error Message:** ${originalError.errorMessage}

## Build Log Excerpt
\`\`\`
${buildLog}
\`\`\`

## Why Auto-Fix Failed
${failureReason}

## Attempted Fix (if any)
${attemptedFix || 'No fix was attempted'}

## Task
Create an informative issue body that helps developers understand and fix the problem.
Include:
1. Clear problem description
2. Relevant log excerpts
3. Suggested investigation steps
4. Any partial analysis that might help

Return markdown-formatted content only:`;
}

export default {
    getRootCausePrompt,
    getPatternMatchPrompt,
    getPRDescriptionPrompt,
    getConfidencePrompt,
    getIssueBodyPrompt,
};
