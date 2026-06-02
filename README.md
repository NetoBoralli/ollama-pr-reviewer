# ollama-pr-reviewer

A PR reviewer with a **swappable LLM backend** and **structured output**. Same
review code path runs on a local Ollama model (free, private, for pre-push
feedback) or on the Anthropic / OpenAI API (for CI inline comments on PRs).

The output vocabulary mirrors the `enhance-code` Claude Code skill — same
severities (`critical` / `warning` / `suggestion`), same categories (`bug`,
`edge-case`, `perf`, `dry`, `magic`, `idiom`, `readability`, `naming`,
`yagni`) — so the local skill and the PR bot feel like the same reviewer in
two places.

## Why this shape

The whole app depends on one small interface, `LLMProvider`
(`src/llm/types.ts`). The backend is chosen by env var in `src/llm/index.ts`.
Everything downstream (`reviewDiff`, formatters, the GitHub poster) only
knows the interface, so swapping backends is a config change.

```
src/
  llm/
    types.ts             # LLMProvider interface (the contract)
    openaiCompatible.ts  # one impl that covers Ollama, vLLM, OpenAI, OpenRouter...
    anthropic.ts         # native Anthropic SDK with prompt caching
    index.ts             # getProvider(): reads env, returns the backend
  output/
    text.ts              # terminal formatter (for local pre-push)
    json.ts              # raw JSON (for piping)
    github.ts            # GitHub Reviews API payload (for CI)
  types.ts               # Finding, Severity, Category — the shared contract
  prompt.ts              # system prompt + JSON schema
  diff.ts                # unified-diff parser, maps line → GitHub position
  config.ts              # loads .pr-review.json
  review.ts              # reviewDiff(provider, diff, config) → Finding[]
  index.ts               # CLI: staged | push | <file> | --stdin
samples/example.diff     # demo diff with planted bugs
```

## Setup

```bash
pnpm install
cp .env.example .env
```

## Three ways to run

### Local — Ollama (free, private)

```bash
ollama serve                       # start the server
ollama pull qwen2.5-coder:7b       # ~4GB, code-tuned 7B
pnpm review                        # reviews the bundled sample diff
pnpm review:staged                 # reviews git diff --staged (pre-commit)
pnpm review:push                   # reviews unpushed commits (pre-push)
pnpm review path/to/your.diff      # or any saved diff
```

### Hosted OpenAI-compatible (OpenAI, OpenRouter, Together, self-hosted vLLM…)

Edit `.env`:

```bash
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
# Optional: point at any compatible endpoint
# OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

### Anthropic (recommended for CI)

Edit `.env`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

The Anthropic provider applies `cache_control: ephemeral` to the static
system prompt, so once the cache is warm the input cost drops ~90% — at
typical CI traffic (~50 engineers, ~450 PR reviews/day) the bill is
roughly **\$50–100/month** on Haiku 4.5.

## CLI

```
pr-review staged              Review currently staged changes (git diff --staged)
pr-review push                Review unpushed commits (git diff @{push}...HEAD)
pr-review <path/to.diff>      Review a saved diff file
pr-review --stdin             Read diff from stdin
pr-review                     Review the bundled sample (for demos)

  --format <text|json|github>   Output format. Default: text.
  --suggestions                 Show low-severity suggestions (hidden by default)
  --force                       Ignore the maxDiffLines cap
```

`--format github` emits a payload ready to feed straight into
`POST /repos/:o/:r/pulls/:n/reviews`, with inline `comments[]` anchored to
real diff positions via `src/diff.ts`.

## Per-repo config

Drop a `.pr-review.json` in the repo root (all fields optional — defaults are
sensible):

```json
{
  "enabled": true,
  "maxDiffLines": 800,
  "severityThreshold": "suggestion",
  "ignoreGlobs": ["package-lock.json", "dist/*", "*.generated.*"],
  "promptAddendum": "This project uses Vitest, not Jest. Prefer `unknown` over `any`."
}
```

`promptAddendum` is the place to encode team conventions so the bot stops
recommending things you've already decided against.

## How to deploy this for a real team

1. **Engineer pre-push (local)** — distribute as a private npm package, wire
   a `pre-push` hook via lefthook in each consumer repo. Engineers run
   `pr-review push` and see findings in their terminal before they push.
   Provider stays `ollama` for offline + free.
2. **CI on PR (authoritative)** — a GitHub Action calls
   `pr-review --stdin --format github` on the PR diff, then `gh api` posts
   the payload as a review. Provider is `anthropic` (or a self-hosted vLLM
   with `LLM_PROVIDER=openai` if compliance requires staying inside the VPC).
3. **Never block.** The Action exits 0 even with findings. Engineers can mute
   per-PR via a comment, per-repo via `enabled: false`, and org-wide via an
   env in the Action.

The Action workflow and a tiny poster script are the next thing to add to
this repo.

## Notes on going to production

- **Ollama is ideal for dev / single-user.** For concurrent server load use
  **vLLM** or **TGI** — they're also OpenAI-compatible, so flip
  `OPENAI_BASE_URL` and you're done.
- **Quality**: 7B–8B local models catch obvious bugs (null derefs, off-by-one,
  SQL injection, missing awaits); subtle review needs 32B+ or a hosted API.
- **Hybrid router** is a natural next step — a fourth `LLMProvider` that runs
  a cheap local first pass and escalates complex hunks to Sonnet/Opus.
  Same interface, no caller changes.
