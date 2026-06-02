import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { ChatMessage, ChatOptions, LLMProvider } from "./types.js";

export interface OpenAICompatibleConfig {
  /** Label for logs, e.g. "ollama" or "openai". */
  name: string;
  /** API root, e.g. http://localhost:11434/v1 for Ollama. */
  baseURL: string;
  /** Model id, e.g. "qwen2.5-coder:7b" or "gpt-4o-mini". */
  model: string;
  /** Ollama ignores this, hosted APIs require it. Defaults to "ollama". */
  apiKey?: string;
}

/**
 * Works against ANY server that implements the OpenAI /v1/chat/completions
 * API — Ollama, vLLM, TGI, OpenAI, OpenRouter, Together, Groq, etc.
 * Switching is purely a matter of baseURL + model + key.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
    this.client = new OpenAI({
      baseURL: config.baseURL,
      // Ollama doesn't check the key but the SDK requires a non-empty value.
      apiKey: config.apiKey ?? "ollama",
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const fullMessages: ChatCompletionMessageParam[] = [];
    if (options.system) {
      fullMessages.push({ role: "system", content: options.system });
    }
    for (const m of messages) {
      fullMessages.push({ role: m.role, content: m.content });
    }

    const params: ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: fullMessages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens,
    };

    if (options.jsonMode) {
      // Supported by OpenAI, Ollama (>=0.5), vLLM, OpenRouter on most models.
      // Models without native JSON mode usually still respect the schema in
      // the system prompt; we parse + validate downstream.
      params.response_format = { type: "json_object" };
    }

    const res = await this.client.chat.completions.create(params);
    const content = res.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`[${this.name}] model returned an empty response`);
    }
    return content;
  }
}
