import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { AnthropicProvider } from "./anthropic.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, ChatMessage, ChatOptions } from "./types.js";

/**
 * Reads the environment and hands back the configured backend.
 *
 * This is the ONLY place that knows which providers exist. The rest of the app
 * depends on the `LLMProvider` interface, so flipping LLM_PROVIDER never
 * touches the review logic.
 */
export function getProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();

  switch (provider) {
    case "ollama":
      return new OpenAICompatibleProvider({
        name: "ollama",
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        model: process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
      });

    // Any hosted OpenAI-compatible API: OpenAI, OpenRouter, Together, Groq,
    // self-hosted vLLM/TGI, etc.
    case "openai":
      return new OpenAICompatibleProvider({
        name: "openai",
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        apiKey: requireEnv("OPENAI_API_KEY"),
      });

    case "anthropic":
      return new AnthropicProvider({
        name: "anthropic",
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
        apiKey: requireEnv("ANTHROPIC_API_KEY"),
        baseURL: process.env.ANTHROPIC_BASE_URL,
      });

    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${provider}". Use "ollama", "openai", or "anthropic".`,
      );
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var ${key} for this provider.`);
  }
  return value;
}
