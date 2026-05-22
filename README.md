# ollama-pr-reviewer

A boilerplate PR reviewer with a **swappable LLM backend**. Run it against a
local **Ollama** model for free during dev, or point it at any hosted
OpenAI-compatible API in production — without touching the review code.

## Why this shape

The whole app depends on one small interface, `LLMProvider` (`src/llm/types.ts`).
The backend is chosen by env var in `src/llm/index.ts`. Everything else
(`reviewDiff`) only knows the interface, so swapping Ollama ↔ a hosted API is a
config change, never a code change.

```
src/
  llm/
    types.ts             # LLMProvider interface (the contract)
    openaiCompatible.ts  # one impl that covers Ollama, vLLM, OpenAI, OpenRouter...
    index.ts             # getProvider(): reads env, returns the backend
  review.ts              # reviewDiff(provider, diff) — provider-agnostic core
  index.ts              # CLI: diff in → review out
samples/example.diff     # demo diff with planted bugs
```

## Setup

```bash
pnpm install
cp .env.example .env
```

### Run with Ollama (local, free)

```bash
ollama serve                       # start the server
ollama pull qwen2.5-coder:7b       # a small code-tuned model
pnpm review                        # reviews samples/example.diff
pnpm review path/to/your.diff      # or your own diff
```

Generate a real diff to feed it:

```bash
git diff main > /tmp/pr.diff && pnpm review /tmp/pr.diff
```

### Switch to a hosted API (no code changes)

Edit `.env`:

```bash
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

Same command, different brain. Point `OPENAI_BASE_URL` at OpenRouter/Together/Groq
to use those instead.

## Notes on going to production

- **Ollama is ideal for dev / single-user.** For concurrent server load, swap in
  **vLLM** or **TGI** — they're also OpenAI-compatible, so only the env changes.
- **Cost model is inverted vs. APIs:** a dedicated GPU costs the same idle or busy.
  Bursty PR traffic suits APIs or scale-to-zero GPUs better than an always-on box.
- **Quality:** 7B–8B local models catch obvious bugs; subtle review needs 30B–70B
  (real GPU) or a frontier API. A natural next step is a **hybrid router** —
  add a third provider that does a cheap local first pass and escalates complex
  diffs to a hosted model. It's just another `LLMProvider`.
```
