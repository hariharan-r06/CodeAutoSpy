/**
 * Surgeon Agent Prompts
 * Prompts for generating code fixes
 */

/**
 * Generate the main surgeon prompt for code fixing
 * @param {object} params - Parameters for the prompt
 * @returns {string} The formatted prompt
 */
export function getSurgeonPrompt({
    filePath,
    lineNumber,
    errorType,
    errorMessage,
    language,
    originalCode,
    relevantLogSection,
    additionalContext = '',
}) {
    const languageSpecificRules = getLanguageRules(language);

    return `You are an expert software engineer specializing in fixing CI/CD failures. Your task is to fix a specific error while making MINIMAL changes to the code.

## Error Context
- **File:** \`${filePath}\`
- **Line:** ${lineNumber || 'Unknown'}
- **Error Type:** ${errorType}
- **Error Message:** ${errorMessage}
- **Language:** ${language}
${additionalContext ? `- **Additional Context:** ${additionalContext}` : ''}

## Original Code
\`\`\`${language}
${originalCode}
\`\`\`

## Build Log Excerpt
\`\`\`
${relevantLogSection || 'No log section available'}
\`\`\`

## Language-Specific Rules
${languageSpecificRules}

## Your Task
Generate the COMPLETE corrected version of this file. Follow these rules STRICTLY:

1. **MINIMAL CHANGES ONLY**: Fix ONLY the specific error mentioned. Do NOT refactor, optimize, or "improve" other parts of the code.

2. **PRESERVE EVERYTHING ELSE**: Keep all comments, formatting, whitespace patterns, and coding style exactly as they are.

3. **NO EXPLANATORY COMMENTS**: Do not add comments explaining the fix.

4. **COMPLETE FILE**: Output the entire file content, not just the changed section.

5. **SYNTAX VALIDATION**: Ensure the fix results in valid syntax for the language.

6. **CONSERVATIVE APPROACH**: When in doubt, make the smallest possible change that fixes the error.

## Response Format
Output ONLY the fixed code, wrapped in a code block with the appropriate language tag. No explanations, no markdown headers, just the code:

\`\`\`${language}
// Your fixed code here
\`\`\``;
}

/**
 * Get language-specific rules for the surgeon prompt
 * @param {string} language - Programming language
 * @returns {string} Language-specific rules
 */
function getLanguageRules(language) {
    const rules = {
        python: `
- Preserve exact indentation (Python is whitespace-sensitive)
- Use consistent quote style (match existing code)
- Maintain import order
- Keep any \`# type:\` comments for type hints
- Preserve blank lines between functions/classes`,

        javascript: `
- Match existing semicolon usage (with or without)
- Preserve quote style (single vs double)
- Keep existing indentation style (spaces vs tabs)
- Maintain import/export syntax style
- Preserve JSDoc comments`,

        typescript: `
- Keep type annotations exactly as they are (unless that's the error)
- Preserve interface/type definitions
- Maintain import type vs import distinction
- Keep generics formatting
- Preserve TSDoc comments`,

        java: `
- Maintain class/method structure
- Keep package declarations
- Preserve import grouping
- Maintain annotation placement
- Keep Javadoc comments`,

        c: `
- Preserve #include order
- Keep preprocessor directives
- Maintain pointer declaration style
- Preserve function prototypes
- Keep header guards`,

        cpp: `
- Preserve namespace structure
- Keep template syntax
- Maintain header/source separation conventions
- Preserve using declarations
- Keep RAII patterns`,

        go: `
- Maintain gofmt-compatible formatting
- Keep error handling patterns
- Preserve package declarations
- Maintain defer usage
- Keep interface compliance`,

        rust: `
- Preserve ownership semantics
- Keep lifetime annotations
- Maintain impl blocks structure
- Preserve macro usage
- Keep trait implementations`,

        dockerfile: `
- Maintain layer ordering
- Keep multi-line RUN commands
- Preserve WORKDIR context
- Maintain ARG/ENV order
- Keep COPY/ADD patterns`,
    };

    return rules[language] || `
- Preserve existing code style and formatting
- Maintain consistent naming conventions
- Keep comments and documentation
- Follow the existing patterns in the code`;
}

/**
 * Generate a prompt for complex multi-line fixes
 * @param {object} params - Parameters for the prompt
 * @returns {string} The formatted prompt
 */
export function getComplexFixPrompt({
    filePath,
    errorType,
    errorMessage,
    language,
    originalCode,
    errorLines,
    relatedFiles = [],
}) {
    let relatedFilesSection = '';
    if (relatedFiles.length > 0) {
        relatedFilesSection = `
## Related Files
${relatedFiles.map(f => `
### ${f.path}
\`\`\`${f.language}
${f.content}
\`\`\`
`).join('\n')}`;
    }

    return `You are an expert software engineer fixing a complex CI/CD failure that may require changes to multiple locations in the file.

## Error Summary
- **File:** \`${filePath}\`
- **Error Type:** ${errorType}
- **Error Message:** ${errorMessage}
- **Language:** ${language}
- **Affected Lines:** ${errorLines.join(', ')}

## Original Code
\`\`\`${language}
${originalCode}
\`\`\`
${relatedFilesSection}

## Task
This error may require fixes in multiple locations. Analyze the error and:
1. Identify ALL locations that need to be changed
2. Make the minimum necessary changes
3. Ensure changes are consistent with each other
4. Output the complete fixed file

## Response Format
Respond with a JSON object containing the fix:
\`\`\`json
{
  "fixedCode": "complete file content with all fixes applied",
  "changesDescription": [
    {"line": 10, "change": "Added missing import"},
    {"line": 45, "change": "Fixed function call"}
  ],
  "confidence": 0.92
}
\`\`\``;
}

/**
 * Generate a prompt for import/dependency fixes
 * @param {object} params - Parameters for the prompt
 * @returns {string} The formatted prompt
 */
export function getImportFixPrompt({
    filePath,
    missingModule,
    language,
    originalCode,
    packageFile,
    existingImports,
}) {
    return `You are an expert software engineer fixing an import/dependency error.

## Error Details
- **File:** \`${filePath}\`
- **Missing Module:** \`${missingModule}\`
- **Language:** ${language}

## Original Code
\`\`\`${language}
${originalCode}
\`\`\`

## Existing Imports in Project
${existingImports.join('\n')}

## Package File (if applicable)
\`\`\`
${packageFile || 'Not available'}
\`\`\`

## Task
Determine the correct fix for this import error:
1. Is it a typo in the import path?
2. Is the import using wrong syntax (relative vs absolute)?
3. Is the module available in the project?
4. Should this be a different module name?

## Response Format
\`\`\`json
{
  "fixType": "typo" | "wrong_path" | "wrong_syntax" | "missing_dependency",
  "correctedImport": "corrected import statement",
  "fixedCode": "complete file content with fix",
  "needsPackageUpdate": false,
  "packageInstallCommand": null,
  "confidence": 0.90
}
\`\`\``;
}

/**
 * Generate a validation prompt for the fix
 * @param {string} originalCode - Original code
 * @param {string} fixedCode - Proposed fix
 * @param {string} language - Programming language
 * @param {string} errorMessage - Original error
 * @returns {string} The formatted prompt
 */
export function getValidationPrompt(originalCode, fixedCode, language, errorMessage) {
    return `You are a code review expert validating an automated fix.

## Original Error
${errorMessage}

## Original Code
\`\`\`${language}
${originalCode}
\`\`\`

## Proposed Fix
\`\`\`${language}
${fixedCode}
\`\`\`

## Validation Task
Analyze the proposed fix and determine:
1. Does it address the original error?
2. Does it introduce any new issues?
3. Are the changes minimal and focused?
4. Is the syntax valid?
5. Could there be any side effects?

## Response Format
\`\`\`json
{
  "isValid": true,
  "addressesError": true,
  "syntaxValid": true,
  "introducesNewIssues": false,
  "changesAreMinimal": true,
  "potentialSideEffects": [],
  "confidence": 0.95,
  "recommendation": "APPROVE" | "MODIFY" | "REJECT",
  "modificationSuggestion": null
}
\`\`\``;
}

/**
 * Generate a prompt for syntax error fixes (common case)
 * @param {object} params - Parameters
 * @returns {string} The formatted prompt
 */
export function getSyntaxFixPrompt({ filePath, lineNumber, language, originalCode, errorMessage }) {
    return `Fix this syntax error in ${language}. The error is on line ${lineNumber || 'unknown'}.

Error: ${errorMessage}

File: ${filePath}

\`\`\`${language}
${originalCode}
\`\`\`

Output ONLY the complete fixed file, no explanations:

\`\`\`${language}
`;
}

export default {
    getSurgeonPrompt,
    getComplexFixPrompt,
    getImportFixPrompt,
    getValidationPrompt,
    getSyntaxFixPrompt,
};
