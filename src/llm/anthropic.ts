import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, LLMProvider } from "./types.js";
import { FINDING_SCHEMA } from "../prompt.js";

export interface AnthropicConfig {
  /** Label for logs, e.g. "anthropic". */
  name: string;
  /** Model id, e.g. "claude-haiku-4-5-20251001". */
  model: string;
  apiKey: string;
  /** Optional override (e.g. for Bedrock or Vertex proxies). */
  baseURL?: string;
}

/**
 * Anthropic-native provider.
 *
 * Uses native cache_control on the system prompt → the static review prompt
 * (~80% of input tokens) is billed at ~10% of the normal input rate on cache
 * hits, which is the difference between the CI bot costing $400/mo and
 * $50/mo at our traffic.
 *
 * For jsonMode it uses a forced `tool_use` call with the finding schema as
 * input_schema — more reliable than asking for JSON in the prompt because
 * the model can't emit anything that doesn't match the schema.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AnthropicConfig) {
    this.name = config.name;
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const systemBlocks = options.system
      ? [
          {
            type: "text" as const,
            text: options.system,
            cache_control: { type: "ephemeral" as const },
          },
        ]
      : undefined;

    const baseParams = {
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.2,
      system: systemBlocks,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (options.jsonMode) {
      const res = await this.client.messages.create({
        ...baseParams,
        tools: [
          {
            name: "submit_findings",
            description:
              "Submit the list of code review findings. Call this exactly once with all findings (or an empty list if the diff is clean).",
            input_schema: FINDING_SCHEMA as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "submit_findings" },
      });

      for (const block of res.content) {
        if (block.type === "tool_use" && block.name === "submit_findings") {
          return JSON.stringify(block.input);
        }
      }
      throw new Error(
        `[${this.name}] model did not return the submit_findings tool call`,
      );
    }

    const res = await this.client.messages.create(baseParams);
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) {
      throw new Error(`[${this.name}] model returned an empty response`);
    }
    return text;
  }
}
