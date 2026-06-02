/**
 * Unified diff parser.
 *
 * The main reason this exists is the GitHub Reviews API: to post an inline
 * comment, you give it a `position` — the line number *within the diff*,
 * counted from the first `@@` hunk header of that file (the line just below
 * the header is position 1). Findings come back from the model anchored to
 * `(file, newLine)`, so we need a way to translate that to `position`.
 *
 * We also expose the set of files in the diff so callers can apply ignore
 * globs *before* sending content to the model.
 */

export interface DiffHunk {
  /** Starting line number in the new (post-change) file. */
  newStart: number;
  /**
   * For each `+` or ` ` (context) line in the hunk, the line number in the
   * new file and the GitHub diff position. `-` (deletion) lines are not
   * included because you cannot anchor a comment on the new file to them.
   */
  lines: Array<{ newLine: number; position: number }>;
}

export interface DiffFile {
  /** Path on the new side, e.g. "src/auth.js". */
  path: string;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
  /** Total number of changed lines (+ and - combined). Used for size gating. */
  changedLines: number;
}

/**
 * Parse a unified diff. Tolerates the common variations git produces
 * (binary files, renames, mode changes) by skipping non-content metadata.
 */
export function parseDiff(diff: string): ParsedDiff {
  const files: DiffFile[] = [];
  let changedLines = 0;

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  // Position resets to 0 at each `diff --git` and increments on every line
  // *after* the first @@ for that file.
  let position = 0;
  let newLine = 0;
  let sawFirstHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      currentFile = null;
      currentHunk = null;
      position = 0;
      newLine = 0;
      sawFirstHunk = false;
      continue;
    }

    if (raw.startsWith("+++ ")) {
      // "+++ b/src/auth.js" → "src/auth.js"; "+++ /dev/null" → deleted file
      const after = raw.slice(4).trim();
      if (after === "/dev/null") {
        currentFile = null;
        continue;
      }
      const path = after.startsWith("b/") ? after.slice(2) : after;
      currentFile = { path, hunks: [] };
      files.push(currentFile);
      continue;
    }

    // Skip the other header noise (---, index, old mode, similarity, etc.)
    if (
      raw.startsWith("--- ") ||
      raw.startsWith("index ") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("similarity") ||
      raw.startsWith("rename ") ||
      raw.startsWith("copy ") ||
      raw.startsWith("Binary files")
    ) {
      continue;
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunkMatch && currentFile) {
      const newStart = Number.parseInt(hunkMatch[1]!, 10);
      currentHunk = { newStart, lines: [] };
      currentFile.hunks.push(currentHunk);
      newLine = newStart;
      // The @@ line itself counts as position 0 conceptually; the next line
      // is position 1.
      if (!sawFirstHunk) {
        position = 0;
        sawFirstHunk = true;
      }
      continue;
    }

    if (!currentFile || !currentHunk || !sawFirstHunk) continue;

    position += 1;
    const marker = raw[0];
    if (marker === "+") {
      currentHunk.lines.push({ newLine, position });
      newLine += 1;
      changedLines += 1;
    } else if (marker === "-") {
      changedLines += 1;
      // Deletion: position advances, newLine does not, no anchor for new file.
    } else if (marker === " " || marker === undefined || raw === "") {
      // Context line. Anchor is valid on context lines too.
      currentHunk.lines.push({ newLine, position });
      newLine += 1;
    } else if (marker === "\\") {
      // "\ No newline at end of file" — does not advance newLine.
    }
  }

  return { files, changedLines };
}

/**
 * Look up the GitHub diff position for (file, lineInNewFile). Returns null if
 * the line isn't in any hunk of that file — which usually means the model
 * anchored a finding outside the changed range. Callers should drop those
 * findings rather than guess.
 */
export function findPosition(
  parsed: ParsedDiff,
  file: string,
  line: number,
): number | null {
  const f = parsed.files.find((x) => x.path === file);
  if (!f) return null;
  for (const hunk of f.hunks) {
    const hit = hunk.lines.find((l) => l.newLine === line);
    if (hit) return hit.position;
  }
  return null;
}
