import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getProvider } from "./llm/index.js";
import { reviewDiff } from "./review.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIFF = join(__dirname, "..", "samples", "example.diff");

/**
 * CLI: `npm run review [path/to/file.diff]`
 * With no argument it reviews the bundled sample diff.
 */
async function main() {
  const diffPath = process.argv[2] ?? DEFAULT_DIFF;

  let diff: string;
  try {
    diff = await readFile(diffPath, "utf8");
  } catch {
    console.error(`Could not read diff file: ${diffPath}`);
    process.exit(1);
  }

  const provider = getProvider();
  console.error(`Reviewing ${diffPath} with provider "${provider.name}"...\n`);

  const start = Date.now();
  const { review } = await reviewDiff(provider, diff);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(review);
  console.error(`\n— done in ${seconds}s`);
}

main().catch((err) => {
  console.error("\nReview failed:", err instanceof Error ? err.message : err);
  console.error(
    "\nIf using Ollama, check the server is up:  ollama serve\n" +
      "and the model is pulled:                  ollama pull qwen2.5-coder:7b",
  );
  process.exit(1);
});
