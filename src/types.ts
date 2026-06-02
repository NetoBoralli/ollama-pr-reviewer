/**
 * Shared types for findings — the contract that providers, formatters, and the
 * CI poster all agree on.
 *
 * Vocabulary mirrors the `enhance-code` skill so the local Claude Code skill and
 * the PR bot feel like the same reviewer.
 */

export type Severity = "critical" | "warning" | "suggestion";

export type Category =
  | "bug"
  | "edge-case"
  | "perf"
  | "dry"
  | "magic"
  | "idiom"
  | "readability"
  | "naming"
  | "yagni";

export interface Finding {
  /** Path as it appears in the diff, e.g. "src/auth.js". */
  file: string;
  /** Line number in the post-change file. */
  line: number;
  severity: Severity;
  category: Category;
  /** One-sentence description of the issue. */
  message: string;
  /** Code snippet showing the recommended fix. Strongly preferred. */
  suggestedFix?: string;
}

export interface ReviewOutput {
  findings: Finding[];
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};
