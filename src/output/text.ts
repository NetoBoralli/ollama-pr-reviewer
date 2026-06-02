import { SEVERITY_RANK, type Finding, type Severity } from "../types.js";
import type { ReviewResult } from "../review.js";

/**
 * Terminal-friendly formatter. Grouped by file, then severity. Critical and
 * warning findings always show; suggestions are hidden unless `showSuggestions`
 * is set — the same "nits hidden by default" rule the bot enforces in CI.
 */
export function formatText(
  result: ReviewResult,
  options: { showSuggestions?: boolean; color?: boolean } = {},
): string {
  const { showSuggestions = false, color = process.stdout.isTTY } = options;
  const c = color ? COLORS : NO_COLORS;

  if (result.skipped) {
    return `${c.dim}— review skipped: ${result.skipped.reason}${c.reset}\n`;
  }

  const visible = result.findings.filter(
    (f) => showSuggestions || f.severity !== "suggestion",
  );

  if (visible.length === 0) {
    const hidden = result.findings.length - visible.length;
    const note = hidden > 0 ? ` (${hidden} suggestions hidden — pass --suggestions to show)` : "";
    return `${c.green}✓ no issues found${c.reset}${c.dim}${note}${c.reset}\n`;
  }

  const byFile = new Map<string, Finding[]>();
  for (const f of visible) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const lines: string[] = [];
  for (const [file, findings] of byFile) {
    lines.push(`${c.bold}${file}${c.reset}`);
    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line);
    for (const f of findings) {
      const sev = severityLabel(f.severity, c);
      lines.push(`  ${sev} ${c.dim}line ${f.line} · ${f.category}${c.reset}`);
      lines.push(`    ${f.message}`);
      if (f.suggestedFix) {
        lines.push(`    ${c.dim}fix:${c.reset}`);
        for (const fixLine of f.suggestedFix.split("\n")) {
          lines.push(`      ${c.cyan}${fixLine}${c.reset}`);
        }
      }
    }
    lines.push("");
  }

  const counts = countBySeverity(result.findings);
  const summary = [
    counts.critical > 0 ? `${c.red}${counts.critical} critical${c.reset}` : null,
    counts.warning > 0 ? `${c.yellow}${counts.warning} warning${c.reset}` : null,
    counts.suggestion > 0
      ? `${c.dim}${counts.suggestion} suggestion${counts.suggestion === 1 ? "" : "s"}${showSuggestions ? "" : " (hidden)"}${c.reset}`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(", ");
  lines.push(`${c.dim}—${c.reset} ${summary}`);

  return lines.join("\n") + "\n";
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

function severityLabel(s: Severity, c: typeof COLORS): string {
  switch (s) {
    case "critical":
      return `${c.red}●${c.reset} ${c.red}${c.bold}CRITICAL${c.reset}`;
    case "warning":
      return `${c.yellow}●${c.reset} ${c.yellow}${c.bold}WARNING${c.reset}`;
    case "suggestion":
      return `${c.dim}●${c.reset} ${c.dim}SUGGESTION${c.reset}`;
  }
}

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const NO_COLORS: typeof COLORS = {
  reset: "",
  bold: "",
  dim: "",
  red: "",
  green: "",
  yellow: "",
  cyan: "",
};
