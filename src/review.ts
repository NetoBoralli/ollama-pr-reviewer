import type { ChatMessage, LLMProvider } from "./llm/index.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { parseDiff } from "./diff.js";
import { isIgnored, type ReviewConfig } from "./config.js";
import {
  SEVERITY_RANK,
  type Finding,
  type ReviewOutput,
  type Severity,
  type Category,
} from "./types.js";

export interface ReviewResult {
  provider: string;
  findings: Finding[];
  /** True if review was skipped (disabled, too large, empty after filtering). */
  skipped?: { reason: string };
}

/**
 * The core unit of work: diff in, structured findings out. Knows nothing about
 * which LLM backend is on the other end of `provider`.
 */
export async function reviewDiff(
  provider: LLMProvider,
  diff: string,
  config: ReviewConfig,
): Promise<ReviewResult> {
  if (!config.enabled) {
    return { provider: provider.name, findings: [], skipped: { reason: "disabled in .pr-review.json" } };
  }
  if (!diff.trim()) {
    return { provider: provider.name, findings: [], skipped: { reason: "empty diff" } };
  }

  const filtered = stripIgnoredFiles(diff, config.ignoreGlobs);
  if (!filtered.trim()) {
    return { provider: provider.name, findings: [], skipped: { reason: "all files ignored" } };
  }

  const parsed = parseDiff(filtered);
  if (parsed.changedLines > config.maxDiffLines) {
    return {
      provider: provider.name,
      findings: [],
      skipped: {
        reason: `diff too large (${parsed.changedLines} changed lines > ${config.maxDiffLines}); run with --force to review anyway`,
      },
    };
  }

  const messages: ChatMessage[] = [
    { role: "user", content: buildUserPrompt(filtered, config.promptAddendum) },
  ];

  const raw = await provider.chat(messages, {
    system: SYSTEM_PROMPT,
    temperature: 0.2,
    jsonMode: true,
    maxTokens: 4096,
  });

  const findings = parseAndValidate(raw, provider.name);
  const aboveThreshold = findings.filter(
    (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[config.severityThreshold],
  );

  return { provider: provider.name, findings: aboveThreshold };
}

/**
 * Strip whole-file diff sections whose path matches the ignore globs.
 * Done at the raw-diff level (not after parsing) so the ignored content is
 * never tokenized in the LLM call.
 */
function stripIgnoredFiles(diff: string, patterns: string[]): string {
  if (patterns.length === 0) return diff;
  const out: string[] = [];
  let skip = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // "diff --git a/path b/path" — pull the b/ path
      const match = / b\/(.+)$/.exec(line);
      const path = match?.[1] ?? "";
      skip = isIgnored(path, patterns);
    }
    if (!skip) out.push(line);
  }
  return out.join("\n");
}

const VALID_SEVERITIES: ReadonlySet<Severity> = new Set([
  "critical",
  "warning",
  "suggestion",
]);
const VALID_CATEGORIES: ReadonlySet<Category> = new Set([
  "bug",
  "edge-case",
  "perf",
  "dry",
  "magic",
  "idiom",
  "readability",
  "naming",
  "yagni",
]);

function parseAndValidate(raw: string, providerName: string): Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(
      `[${providerName}] model output was not valid JSON: ${(err as Error).message}\n\nRaw output:\n${raw.slice(0, 500)}`,
    );
  }

  const obj = parsed as Partial<ReviewOutput>;
  if (!obj || !Array.isArray(obj.findings)) {
    throw new Error(`[${providerName}] model output missing "findings" array`);
  }

  const out: Finding[] = [];
  for (const f of obj.findings) {
    if (
      typeof f.file !== "string" ||
      typeof f.line !== "number" ||
      !VALID_SEVERITIES.has(f.severity as Severity) ||
      !VALID_CATEGORIES.has(f.category as Category) ||
      typeof f.message !== "string"
    ) {
      // Skip malformed entries rather than throwing — partial results are
      // more useful than no results.
      continue;
    }
    out.push({
      file: f.file,
      line: Math.max(1, Math.floor(f.line)),
      severity: f.severity as Severity,
      category: f.category as Category,
      message: f.message.trim(),
      suggestedFix: typeof f.suggestedFix === "string" ? f.suggestedFix : undefined,
    });
  }
  return out;
}

/**
 * Some models (smaller Ollama ones especially) wrap JSON in markdown fences
 * or add a leading sentence even when told not to. Be forgiving.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fence = /```(?:json)?\s*(\{[\s\S]*\})\s*```/.exec(trimmed);
  if (fence) return fence[1]!;
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
