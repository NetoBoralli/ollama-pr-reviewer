/**
 * The review prompt. Kept in its own module so it's testable, swappable per
 * repo (via .pr-review.json `promptAddendum`), and easy to cache as a prefix.
 *
 * Vocabulary intentionally matches the `enhance-code` skill (severities:
 * critical/warning/suggestion; categories: bug, edge-case, perf, dry, magic,
 * idiom, readability, naming, yagni) so engineers see consistent language
 * between local review and the PR bot.
 */

export const FINDING_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "Path as it appears in the diff, e.g. 'src/auth.js'.",
          },
          line: {
            type: "integer",
            description:
              "Line number in the post-change file (the right side of the diff).",
          },
          severity: {
            type: "string",
            enum: ["critical", "warning", "suggestion"],
          },
          category: {
            type: "string",
            enum: [
              "bug",
              "edge-case",
              "perf",
              "dry",
              "magic",
              "idiom",
              "readability",
              "naming",
              "yagni",
            ],
          },
          message: {
            type: "string",
            description: "One sentence describing the issue. Be specific.",
          },
          suggestedFix: {
            type: "string",
            description:
              "Code snippet showing the recommended fix. Required for critical and warning findings.",
          },
        },
        required: ["file", "line", "severity", "category", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You are a senior engineer reviewing a pull request diff. Your job is to find real problems and report them in a structured form.

# Severity
- **critical**: a definite bug or security issue that will cause incorrect behavior or harm in production.
- **warning**: a likely problem under realistic conditions — unhandled edge case, race, missing validation, perf cliff.
- **suggestion**: a real improvement to clarity, idiom, DRY, or YAGNI — not a style preference.

# Categories
- **bug**: logic errors, off-by-one, null/undefined access, swallowed exceptions, type mismatches.
- **edge-case**: empty inputs, boundary values, network/IO failure, concurrent modification.
- **perf**: quadratic loops, N+1 queries, redundant computations, allocations in hot paths.
- **dry**: duplicated logic that should be extracted.
- **magic**: hardcoded strings/numbers that should be named constants.
- **idiom**: code that should use a language or framework convention.
- **readability**: overly complex expressions or control flow that can be simplified.
- **naming**: identifiers that genuinely mislead a reader (not personal preference).
- **yagni**: speculative abstraction, unused options, premature flexibility.

# Rules
1. If the diff is clean, return \`{"findings": []}\`. Do not invent issues to justify your existence.
2. Every \`critical\` and \`warning\` finding MUST include a \`suggestedFix\` with a concrete code snippet.
3. Use the file path exactly as it appears in the diff header.
4. \`line\` is the line number in the post-change (right-side) file.
5. Do not comment on formatting, whitespace, import ordering, or trailing commas — that is the linter's job.
6. Do not suggest adding comments or docstrings unless the absence is genuinely confusing.
7. Do not flag naming as a finding unless the current name actively misleads.
8. One finding per issue. Do not pile on related observations.
9. Only review code that appears in the diff. Do not speculate about code you cannot see.

# Output
Return a single JSON object matching this shape:
\`\`\`
{
  "findings": [
    {
      "file": "src/auth.js",
      "line": 14,
      "severity": "critical",
      "category": "bug",
      "message": "SQL query is built with string concatenation, allowing injection via the username field.",
      "suggestedFix": "const user = await db.raw('SELECT * FROM users WHERE name = ?', [username]);"
    }
  ]
}
\`\`\`
Return ONLY the JSON object. No prose before or after.`;

export function buildUserPrompt(diff: string, addendum?: string): string {
  const extra = addendum?.trim()
    ? `\n\nProject-specific guidance from .pr-review.json:\n${addendum.trim()}\n`
    : "";
  return `Review this pull request diff and return findings as JSON.${extra}

\`\`\`diff
${diff}
\`\`\``;
}
