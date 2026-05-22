/**
 * The contract every LLM backend must satisfy.
 *
 * Keeping this deliberately small (one method) is what makes the backend a
 * config choice instead of a code change. Ollama, vLLM, OpenAI, OpenRouter,
 * Together, etc. all speak the OpenAI chat format, so one implementation
 * (`OpenAICompatibleProvider`) covers them all. A backend that does NOT speak
 * that format (e.g. native AWS Bedrock) would just be another class
 * implementing this same interface.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  /** Soft cap on response length. Maps to max_tokens. */
  maxTokens?: number;
}

export interface LLMProvider {
  /** Human-readable id, used in logs so you know which backend answered. */
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
