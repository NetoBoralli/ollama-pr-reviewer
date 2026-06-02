import "dotenv/config";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getProvider } from "./llm/index.js";
import { reviewDiff } from "./review.js";
import { loadConfig } from "./config.js";
import { formatText } from "./output/text.js";
import { formatJson } from "./output/json.js";
import { formatGitHub } from "./output/github.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIFF = join(__dirname, "..", "samples", "example.diff");

type Format = "text" | "json" | "github";

interface Args {
  command: "staged" | "push" | "file" | "stdin" | "sample";
  diffPath?: string;
  format: Format;
  showSuggestions: boolean;
  force: boolean;
}

const USAGE = `pr-review — structured PR review via swappable LLM backends.

Usage:
  pr-review staged              Review currently staged changes (git diff --staged)
  pr-review push                Review unpushed commits (git diff @{push}...HEAD)
  pr-review <path/to.diff>      Review a saved diff file
  pr-review --stdin             Read diff from stdin
  pr-review                     Review the bundled sample (for demos)

Options:
  --format <text|json|github>   Output format. Default: text
  --suggestions                 Include low-severity suggestions in output
  --force                       Ignore the maxDiffLines cap
  -h, --help                    Show this help

Environment:
  LLM_PROVIDER                  ollama (default) | openai | anthropic
  See .env.example for provider-specific keys.`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "sample",
    format: "text",
    showSuggestions: false,
    force: false,
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--stdin") {
      args.command = "stdin";
    } else if (a === "--suggestions") {
      args.showSuggestions = true;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--format") {
      const next = argv[++i];
      if (next !== "text" && next !== "json" && next !== "github") {
        die(`--format must be one of: text, json, github (got ${next ?? "nothing"})`);
      }
      args.format = next;
    } else if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      if (v !== "text" && v !== "json" && v !== "github") {
        die(`--format must be one of: text, json, github (got ${v})`);
      }
      args.format = v;
    } else if (a.startsWith("-")) {
      die(`unknown flag: ${a}\n\n${USAGE}`);
    } else {
      positional.push(a);
    }
  }

  const first = positional[0];
  if (first === "staged" || first === "push") {
    args.command = first;
  } else if (first) {
    args.command = "file";
    args.diffPath = first;
  }
  return args;
}

async function getDiff(args: Args): Promise<{ diff: string; source: string }> {
  switch (args.command) {
    case "stdin":
      return { diff: await readStream(process.stdin), source: "stdin" };
    case "staged": {
      const { stdout } = await execFileAsync("git", ["diff", "--staged"], {
        maxBuffer: 32 * 1024 * 1024,
      });
      return { diff: stdout, source: "git diff --staged" };
    }
    case "push": {
      // Try @{push} first (the canonical "what's about to be pushed"), fall
      // back to origin/main, origin/master if no upstream is configured.
      for (const ref of ["@{push}", "origin/main", "origin/master"]) {
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["diff", `${ref}...HEAD`],
            { maxBuffer: 32 * 1024 * 1024 },
          );
          if (stdout.trim()) return { diff: stdout, source: `git diff ${ref}...HEAD` };
        } catch {
          // try next ref
        }
      }
      throw new Error(
        "Could not resolve a base ref for `push`. Set an upstream (git push -u) or run on a branch that diverges from origin/main.",
      );
    }
    case "file":
      return { diff: await readFile(args.diffPath!, "utf8"), source: args.diffPath! };
    case "sample":
      return { diff: await readFile(DEFAULT_DIFF, "utf8"), source: DEFAULT_DIFF };
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  if (args.force) config.maxDiffLines = Number.POSITIVE_INFINITY;

  const { diff, source } = await getDiff(args);
  const provider = getProvider();
  console.error(`Reviewing ${source} with provider "${provider.name}"...`);

  const start = Date.now();
  const result = await reviewDiff(provider, diff, config);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  switch (args.format) {
    case "text":
      process.stdout.write(formatText(result, { showSuggestions: args.showSuggestions }));
      break;
    case "json":
      process.stdout.write(formatJson(result) + "\n");
      break;
    case "github":
      process.stdout.write(
        JSON.stringify(
          formatGitHub(result, diff, { includeSuggestions: args.showSuggestions }),
          null,
          2,
        ) + "\n",
      );
      break;
  }

  console.error(`— done in ${seconds}s`);
  // Always exit 0. The bot reports; it never blocks the workflow.
  process.exit(0);
}

main().catch((err) => {
  console.error("\nReview failed:", err instanceof Error ? err.message : err);
  if (process.env.LLM_PROVIDER === undefined || process.env.LLM_PROVIDER === "ollama") {
    console.error(
      "\nIf using Ollama, check the server is up:  ollama serve\n" +
        "and the model is pulled:                  ollama pull qwen2.5-coder:7b",
    );
  }
  process.exit(1);
});
