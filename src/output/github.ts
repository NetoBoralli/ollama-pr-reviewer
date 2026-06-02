import { findPosition, parseDiff } from "../diff.js";
import { SEVERITY_RANK, type Finding, type Severity } from "../types.js";
import type { ReviewResult } from "../review.js";

/**
 * Build a GitHub Reviews API payload from review findings.
 *
 * Two parts:
 *   - `comments[]`: one inline comment per finding that maps to a real diff
 *     position. Findings whose `(file, line)` is outside the changed range
 *     are demoted to the summary instead of being silently dropped.
 *   - `body`: a single top-level summary with severity counts.
 *
 * The poster script (in CI) feeds this straight into
 * `POST /repos/:o/:r/pulls/:n/reviews`.
 */
export interface GitHubReviewPayload {
  event: "COMMENT";
  body: string;
  comments: Array<{ path: string; position: number; body: string }>;
}

export function formatGitHub(
  result: ReviewResult,
  diff: string,
  options: { includeSuggestions?: boolean } = {},
): GitHubReviewPayload {
  const { includeSuggestions = false } = options;

  if (result.skipped) {
    return {
      event: "COMMENT",
      body: `🤖 Review skipped: ${result.skipped.reason}`,
      comments: [],
    };
  }

  const parsed = parseDiff(diff);
  const visible = result.findings.filter(
    (f) => includeSuggestions || f.severity !== "suggestion",
  );

  const comments: GitHubReviewPayload["comments"] = [];
  const orphans: Finding[] = [];

  for (const f of visible) {
    const position = findPosition(parsed, f.file, f.line);
    if (position === null) {
      orphans.push(f);
      continue;
    }
    comments.push({ path: f.file, position, body: renderCommentBody(f) });
  }

  const body = renderSummary(result.findings, orphans, includeSuggestions);
  return { event: "COMMENT", body, comments };
}

function renderCommentBody(f: Finding): string {
  const sev = SEVERITY_BADGE[f.severity];
  const head = `${sev} **${f.category}** — ${f.message}`;
  if (!f.suggestedFix) return head;
  return `${head}\n\n\`\`\`suggestion\n${f.suggestedFix}\n\`\`\``;
}

function renderSummary(
  all: Finding[],
  orphans: Finding[],
  includeSuggestions: boolean,
): string {
  const counts = countBySeverity(all);
  const parts: string[] = ["### 🤖 PR review"];
  const summary = [
    counts.critical > 0 ? `**${counts.critical} critical**` : null,
    counts.warning > 0 ? `**${counts.warning} warning**` : null,
    counts.suggestion > 0
      ? `${counts.suggestion} suggestion${counts.suggestion === 1 ? "" : "s"}${includeSuggestions ? "" : " (hidden)"}`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");
  parts.push(summary || "No issues found ✅");

  if (orphans.length > 0) {
    parts.push("\n<details><summary>Findings outside the diff range</summary>\n");
    orphans.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    for (const f of orphans) {
      parts.push(
        `- ${SEVERITY_BADGE[f.severity]} \`${f.file}:${f.line}\` — ${f.message}`,
      );
    }
    parts.push("\n</details>");
  }

  parts.push(
    "\n<sub>Comment `@review-bot mute` to silence on this PR. Configure in `.pr-review.json`.</sub>",
  );
  return parts.join("\n");
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "💡",
};
