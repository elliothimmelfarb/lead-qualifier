/**
 * Session-per-lead.
 *
 * One lead, one conversation, one record. The session owns the turn loop and
 * nothing else: it asks the model, hands the proposal to the guard, writes the
 * result to the store, and - when the guard overrules the model - injects the
 * override back into the transcript so the next turn is grounded in the real
 * decision.
 *
 * Note what is NOT here: no business rules, no prompt text, no persistence
 * details, no SDK. Those live in domain/, agents/, store/ and the model
 * implementations respectively. This file is the only place they meet.
 */

import { decide, overrideNote } from "../domain/qualification.js";
import { EMPTY_FIELDS } from "../domain/types.js";
import type { GuardDecision, LeadFields } from "../domain/types.js";
import type { LeadSessionRecord, Store, TranscriptEntry } from "../store/index.js";
import type { LoadedAgent } from "./spec.js";
import type { ModelReply, QualifierModel } from "./model.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface SessionDeps {
  agent: LoadedAgent;
  model: QualifierModel;
  store: Store;
  clock?: Clock;
}

/** What one call to `send()` produced. */
export interface Turn {
  leadMessage: string;
  reply: string;
  fields: LeadFields;
  decision: GuardDecision;
  /** The note injected into the transcript, if the guard overruled the model. */
  overrideNote: string | null;
}

export class LeadSession {
  readonly leadId: string;
  readonly #agent: LoadedAgent;
  readonly #model: QualifierModel;
  readonly #store: Store;
  readonly #clock: Clock;

  constructor(leadId: string, deps: SessionDeps) {
    this.leadId = leadId;
    this.#agent = deps.agent;
    this.#model = deps.model;
    this.#store = deps.store;
    this.#clock = deps.clock ?? systemClock;
  }

  async #load(): Promise<LeadSessionRecord> {
    const existing = await this.#store.get(this.leadId);
    if (existing) return existing;
    const now = this.#clock.now().toISOString();
    return {
      leadId: this.leadId,
      agentName: this.#agent.name,
      agentVersion: this.#agent.version,
      transcript: [],
      fields: { ...EMPTY_FIELDS },
      lastProposal: null,
      decision: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async record(): Promise<LeadSessionRecord | null> {
    return this.#store.get(this.leadId);
  }

  /**
   * One turn: lead speaks, model proposes, code decides, store persists.
   *
   * A terminal verdict short-circuits. Once a lead is `disqualified` there is
   * nothing further to extract and no reason to spend another model call, so
   * later messages get a fixed reply and the standing decision.
   */
  async send(leadMessage: string): Promise<Turn> {
    const record = await this.#load();
    const now = () => this.#clock.now().toISOString();

    if (record.decision?.verdict === "disqualified") {
      record.transcript.push({ role: "lead", text: leadMessage, at: now() });
      const reply =
        "I'm afraid this trip isn't one we can run - happy to help if anything changes.";
      record.transcript.push({ role: "agent", text: reply, at: now() });
      record.updatedAt = now();
      await this.#store.put(record);
      return {
        leadMessage,
        reply,
        fields: record.fields,
        decision: record.decision,
        overrideNote: null,
      };
    }

    record.transcript.push({ role: "lead", text: leadMessage, at: now() });

    const proposal: ModelReply = await this.#model.complete({
      system: this.#agent.systemPromptText,
      transcript: record.transcript,
    });

    // Fields accumulate: a value the model reported two turns ago is not lost
    // just because it left this turn's payload blank.
    const merged: LeadFields = {
      budgetPerPersonUsd:
        proposal.fields.budgetPerPersonUsd ?? record.fields.budgetPerPersonUsd,
      groupSize: proposal.fields.groupSize ?? record.fields.groupSize,
      startDateIso: proposal.fields.startDateIso ?? record.fields.startDateIso,
      fitnessLevel: proposal.fields.fitnessLevel ?? record.fields.fitnessLevel,
    };

    const decision = decide({
      proposal: {
        fields: merged,
        proposedQualified: proposal.proposedQualified,
        rationale: proposal.rationale,
      },
      today: this.#clock.now(),
    });

    record.transcript.push({ role: "agent", text: proposal.reply, at: now() });

    const note = overrideNote(decision);
    if (note !== null) {
      // The feedback loop that keeps conversation and decision in sync.
      record.transcript.push({ role: "system", text: note, at: now() });
    }

    record.fields = merged;
    record.lastProposal = {
      fields: merged,
      proposedQualified: proposal.proposedQualified,
      rationale: proposal.rationale,
    };
    record.decision = decision;
    record.updatedAt = now();
    await this.#store.put(record);

    return {
      leadMessage,
      reply: proposal.reply,
      fields: merged,
      decision,
      overrideNote: note,
    };
  }
}

export interface TranscriptView {
  entries: readonly TranscriptEntry[];
  decision: GuardDecision | null;
}
