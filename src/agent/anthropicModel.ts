/**
 * The real model call. One file, one responsibility: turn a transcript into a
 * validated `ModelReply`. It knows nothing about the guard, the store, or what
 * a "lead" is.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LoadedAgent } from "./spec.js";
import {
  parseModelReply,
  REPLY_JSON_SCHEMA,
  type ModelReply,
  type ModelRequest,
  type QualifierModel,
} from "./model.js";
import type { TranscriptEntry } from "../store/index.js";

/**
 * Roles map onto the Messages API as you would expect, with one wrinkle: our
 * `system` transcript entries are the guard's override notes. They are appended
 * to `messages` as user-turn text rather than folded into the top-level system
 * prompt, so the cached system prefix stays byte-identical across the whole
 * conversation.
 */
function toMessages(
  transcript: readonly TranscriptEntry[],
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const entry of transcript) {
    if (entry.role === "agent") {
      messages.push({ role: "assistant", content: entry.text });
    } else {
      messages.push({ role: "user", content: entry.text });
    }
  }
  return messages;
}

export class AnthropicQualifierModel implements QualifierModel {
  readonly id: string;
  readonly #client: Anthropic;
  readonly #agent: LoadedAgent;

  constructor(agent: LoadedAgent, client = new Anthropic()) {
    this.#agent = agent;
    this.#client = client;
    this.id = agent.model;
  }

  async complete(req: ModelRequest): Promise<ModelReply> {
    const response = await this.#client.messages.create({
      model: this.#agent.model,
      max_tokens: this.#agent.maxTokens,
      temperature: this.#agent.temperature,
      // The system prompt is stable for the life of the agent version, so it is
      // the natural cache prefix.
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      // Structured outputs make the reply shape a server-side guarantee rather
      // than a hope. We still validate with zod on receipt.
      output_config: {
        format: { type: "json_schema", schema: REPLY_JSON_SCHEMA },
      },
      messages: toMessages(req.transcript),
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        "Model declined to answer this turn; escalate the lead to a human.",
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Model returned non-JSON output: ${text.slice(0, 200)}`);
    }
    return parseModelReply(raw);
  }
}
