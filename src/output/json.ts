import type { ReviewResult } from "../review.js";

/**
 * Raw JSON formatter. Mostly useful as input to other tools (the CI poster
 * script, dashboards, scripted post-processing).
 */
export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2);
}
