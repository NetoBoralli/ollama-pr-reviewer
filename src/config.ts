import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Severity } from "./types.js";

/**
 * Optional per-repo config, loaded from `.pr-review.json` in cwd.
 *
 * Defaults are deliberately sensible enough that adding the file is optional —
 * the bot should work with zero config in any repo.
 */
export interface ReviewConfig {
  enabled: boolean;
  /**
   * Glob-ish patterns (no globbing — substring or simple `*` suffix) for paths
   * to drop from the diff before review. Saves tokens and removes the noise
   * of "you should review lockfile" findings.
   */
  ignoreGlobs: string[];
  /**
   * Diff lines above this trigger a single "diff too large" notice instead of
   * a real review. Keeps cost predictable on giant refactors.
   */
  maxDiffLines: number;
  /** Findings below this severity are dropped before output. */
  severityThreshold: Severity;
  /** Extra prompt text appended to the system prompt (team conventions). */
  promptAddendum?: string;
}

const DEFAULTS: ReviewConfig = {
  enabled: true,
  ignoreGlobs: [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "*.lock",
    "dist/*",
    "build/*",
    "*.generated.*",
    "*.min.js",
    "*.min.css",
  ],
  maxDiffLines: 800,
  severityThreshold: "suggestion",
};

export async function loadConfig(cwd: string = process.cwd()): Promise<ReviewConfig> {
  try {
    const raw = await readFile(join(cwd, ".pr-review.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReviewConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Returns true if the path matches any of the ignore patterns. Patterns are
 * either an exact path, a substring contains, or a `prefix/*` / `*.ext` shape.
 * Kept intentionally small — full globbing isn't worth a dep here.
 */
export function isIgnored(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === path) return true;
    if (pattern.endsWith("/*") && path.startsWith(pattern.slice(0, -1))) return true;
    if (pattern.startsWith("*.") && path.endsWith(pattern.slice(1))) return true;
    if (pattern.includes("*.")) {
      const idx = pattern.indexOf("*.");
      const suffix = pattern.slice(idx + 1);
      if (path.endsWith(suffix)) return true;
    }
  }
  return false;
}
