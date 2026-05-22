import type { ChatMessage, LLMProvider } from "./llm/index.js";

const SYSTEM_PROMPT = `You are a senior software engineer reviewing a pull request.
Review the unified diff and report only what matters. Be concise and specific.

Group your findings under these headings (omit a heading if it has nothing):
- **Bugs & correctness** — logic errors, edge cases, null/undefined, off-by-one.
- **Security** — injection, auth, secrets, unsafe input handling.
- **Design & maintainability** — naming, duplication, unclear structure.
- **Nits** — minor style/readability points.

For each finding, reference the file and line where you can, explain the risk in
one sentence, and suggest the fix. If the diff looks good, say so plainly.
Do not invent code that isn't in the diff.`;

export interface ReviewResult {
  provider: string;
  review: string;
}

/**
 * The core unit of work: diff in, review out. Knows nothing about which LLM
 * backend it's talking to — it only sees the LLMProvider interface.
 */
export async function reviewDiff(
  provider: LLMProvider,
  diff: string,
): Promise<ReviewResult> {
  if (!diff.trim()) {
    throw new Error("Empty diff — nothing to review.");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Review this pull request diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
    },
  ];

  const review = await provider.chat(messages, { temperature: 0.2 });
  return { provider: provider.name, review };
}
