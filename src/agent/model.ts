/**
 * The model is an interface with two implementations: the real Anthropic call
 * and a scripted mock. Everything above this line (session, guard, store, sim)
 * is written against the interface, which is why the entire system - including
 * the persona integration suite - runs with no credentials at all.
 */

import { z } from "zod";
import type { AgentProposal, LeadFields } from "../domain/types.js";
import type { TranscriptEntry } from "../store/index.js";

export interface ModelRequest {
  system: string;
  transcript: readonly TranscriptEntry[];
}

export interface ModelReply extends AgentProposal {
  /** The text the lead sees. */
  reply: string;
}

export interface QualifierModel {
  /** Identifier for logs and the demo header, e.g. "mock" or the model id. */
  readonly id: string;
  complete(req: ModelRequest): Promise<ModelReply>;
}

const fitnessSchema = z.enum(["low", "moderate", "high"]);

/**
 * The contract we hold the model to. Model output is untrusted input: it is
 * parsed and coerced here, and anything that fails validation degrades to
 * `null` rather than propagating a surprise into the guard.
 */
export const modelReplySchema = z.object({
  reply: z.string().min(1),
  fields: z.object({
    budgetPerPersonUsd: z.number().finite().positive().nullable().catch(null),
    groupSize: z.number().int().nullable().catch(null),
    startDateIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .catch(null),
    fitnessLevel: fitnessSchema.nullable().catch(null),
  }),
  proposedQualified: z.boolean(),
  rationale: z.string().default(""),
});

export function parseModelReply(raw: unknown): ModelReply {
  const parsed = modelReplySchema.parse(raw);
  const fields: LeadFields = parsed.fields;
  return {
    reply: parsed.reply,
    fields,
    proposedQualified: parsed.proposedQualified,
    rationale: parsed.rationale,
  };
}

/** The JSON Schema handed to the API so the model's output shape is enforced. */
export const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    fields: {
      type: "object",
      properties: {
        budgetPerPersonUsd: { type: ["integer", "null"] },
        groupSize: { type: ["integer", "null"] },
        startDateIso: { type: ["string", "null"] },
        fitnessLevel: {
          type: ["string", "null"],
          enum: ["low", "moderate", "high", null],
        },
      },
      required: [
        "budgetPerPersonUsd",
        "groupSize",
        "startDateIso",
        "fitnessLevel",
      ],
      additionalProperties: false,
    },
    proposedQualified: { type: "boolean" },
    rationale: { type: "string" },
  },
  required: ["reply", "fields", "proposedQualified", "rationale"],
  additionalProperties: false,
} as const;
