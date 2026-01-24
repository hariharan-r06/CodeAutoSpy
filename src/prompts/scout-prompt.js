/**
 * Scout Agent Prompts
 * Prompts for analyzing build logs and detecting broken files
 */

/**
 * Generate the main scout prompt for log analysis
 * @param {string} buildLog - The raw build log
 * @param {string} language - Detected language (optional hint)
 * @returns {string} The formatted prompt
 */
export function getScoutPrompt(buildLog, language = null) {
    const languageHint = language
        ? `\n**Hint:** The project appears to use ${language}.`
        : '';

    return `You are an expert CI/CD failure detective. Your job is to analyze build logs and identify the exact source of failure with precision.

## Your Task
Analyze the following build log and extract:
1. The EXACT file path that caused the failure (relative to project root)
2. The specific line number where the error occurred (if available)
3. The type of error (e.g., SyntaxError, ImportError, CompilationError)
4. A concise description of what went wrong
5. Your confidence level (0.0 to 1.0)
${languageHint}

## Guidelines
- Focus on the FIRST error that occurred (subsequent errors may be cascading)
- Look for file paths in error messages, stack traces, and compiler outputs
- Identify the specific error type from the programming language
- If multiple files are involved, identify the PRIMARY source file
- Normalize file paths (remove build directory prefixes like /github/workspace/)
- If you cannot determine the file, set filePath to null
- Be conservative with confidence - lower confidence if information is ambiguous

## Common Error Patterns
- Python: "File '<path>', line <num>" followed by error type
- JavaScript/Node: "<path>:<line>:<col>" with error description
- TypeScript: "<path>(<line>,<col>): error TS<code>"
- Java: "<path>:<line>: error:" or exception stack traces
- Go: "<path>:<line>:<col>:" with error message
- Docker: "Step <n>/<m> :" with failure description
- C/C++: "<path>:<line>:<col>: error:"

## Build Log
\`\`\`
${buildLog}
\`\`\`

## Response Format
Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "filePath": "src/components/Header.js",
  "lineNumber": 42,
  "errorType": "SyntaxError",
  "errorMessage": "Missing closing parenthesis after argument list",
  "language": "javascript",
  "confidence": 0.95,
  "additionalContext": "The error appears at the end of a function call"
}

If you cannot determine the error location, respond with:
{
  "filePath": null,
  "lineNumber": null,
  "errorType": "Unknown",
  "errorMessage": "Could not parse error from logs",
  "language": null,
  "confidence": 0.0,
  "additionalContext": "Logs did not contain recognizable error patterns"
}`;
}

/**
 * Generate a focused prompt for specific error types
 * @param {string} buildLog - The raw build log
 * @param {string} errorType - Known error type
 * @returns {string} The formatted prompt
 */
export function getFocusedScoutPrompt(buildLog, errorType) {
    const errorHints = {
        SyntaxError: `
## Syntax Error Detection Focus
- Look for missing brackets, parentheses, or quotes
- Check for indentation errors (especially in Python)
- Find unexpected tokens or missing semicolons
- Identify unclosed strings or template literals`,

        ImportError: `
## Import/Module Error Detection Focus
- Find the missing module or package name
- Check if the import path is incorrect
- Look for typos in import statements
- Identify if it's a relative vs absolute import issue`,

        TypeError: `
## Type Error Detection Focus
- Find type mismatches in function calls
- Check for null/undefined access
- Look for incorrect argument types
- Identify property access on wrong types`,

        CompilationError: `
## Compilation Error Detection Focus
- Find syntax errors reported by compiler
- Check for missing type declarations
- Look for incompatible assignments
- Identify missing dependencies`,

        DockerError: `
## Docker Error Detection Focus
- Check COPY source paths
- Verify file permissions
- Look for missing dependencies in RUN commands
- Check base image availability`,
    };

    const hint = errorHints[errorType] || '';

    return `You are an expert CI/CD failure detective specializing in ${errorType} issues.
${hint}

## Build Log
\`\`\`
${buildLog}
\`\`\`

## Response Format
Respond ONLY with a valid JSON object:
{
  "filePath": "string or null",
  "lineNumber": "number or null",
  "errorType": "${errorType}",
  "errorMessage": "concise description",
  "language": "detected language",
  "confidence": 0.95,
  "suggestedFix": "brief suggestion"
}`;
}

/**
 * Generate a prompt for multi-error analysis
 * @param {string} buildLog - The raw build log
 * @returns {string} The formatted prompt
 */
export function getMultiErrorPrompt(buildLog) {
    return `You are an expert CI/CD failure analyst. Analyze this build log and identify ALL errors present.

## Build Log
\`\`\`
${buildLog}
\`\`\`

## Response Format
Respond ONLY with a valid JSON object containing an array of errors:
{
  "primaryError": {
    "filePath": "src/main.py",
    "lineNumber": 10,
    "errorType": "SyntaxError",
    "errorMessage": "unexpected EOF while parsing",
    "confidence": 0.95
  },
  "secondaryErrors": [
    {
      "filePath": "src/utils.py",
      "lineNumber": 25,
      "errorType": "ImportError",
      "errorMessage": "cannot import 'main'",
      "isCausedByPrimary": true
    }
  ],
  "totalErrors": 2,
  "recommendation": "Fix the primary error first, secondary errors may resolve automatically"
}`;
}

/**
 * Generate a verification prompt to double-check findings
 * @param {object} finding - Initial finding from scout
 * @param {string} fileContent - Content of the suspected file
 * @returns {string} The formatted prompt
 */
export function getVerificationPrompt(finding, fileContent) {
    return `You are verifying a CI/CD failure diagnosis. Confirm if the identified error is correct.

## Initial Finding
- File: ${finding.filePath}
- Line: ${finding.lineNumber}
- Error Type: ${finding.errorType}
- Message: ${finding.errorMessage}

## File Content (with line numbers)
\`\`\`
${fileContent.split('\n').map((line, i) => `${(i + 1).toString().padStart(4, ' ')} | ${line}`).join('\n')}
\`\`\`

## Task
1. Verify if the error actually exists at the specified location
2. Confirm the error type and message
3. If the initial diagnosis is wrong, provide the correct information

## Response Format
Respond ONLY with a valid JSON object:
{
  "verified": true,
  "correctedLineNumber": 42,
  "correctedErrorType": "SyntaxError",
  "actualIssue": "Missing closing brace",
  "surroundingContext": "The function definition is incomplete",
  "confidence": 0.98
}`;
}

export default {
    getScoutPrompt,
    getFocusedScoutPrompt,
    getMultiErrorPrompt,
    getVerificationPrompt,
};
