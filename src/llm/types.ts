/**
 * The contract every LLM backend must satisfy.
 *
 * Keeping this small is what makes the backend a config choice instead of a
 * code change. Ollama, vLLM, OpenAI, OpenRouter, Together, etc. all speak the
 * OpenAI chat format → one impl covers them all. Anthropic uses its own
 * native SDK because we want first-class prompt caching, but it implements
 * the same `LLMProvider` interface.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /**
   * System prompt. Kept separate from `messages` so providers can apply native
   * caching (Anthropic cache_control, OpenAI cached prefix) without the caller
   * caring about the mechanism.
   */
  system?: string;
  temperature?: number;
  /** Soft cap on response length. Maps to max_tokens. */
  maxTokens?: number;
  /**
   * Force JSON output. Each provider does this its native way: OpenAI-compat
   * uses `response_format: { type: "json_object" }`; Anthropic uses a forced
   * `tool_use` call. Callers still need to JSON.parse the returned string.
   */
  jsonMode?: boolean;
}

export interface LLMProvider {
  /** Human-readable id, used in logs so you know which backend answered. */
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
