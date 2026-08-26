/**
 * Persistence is an interface with a boring default.
 *
 * The in-memory implementation is the default so the whole system runs, and the
 * whole test suite passes, with zero credentials and zero services. A Redis
 * sketch lives in `redis.ts` to show the seam is real without dragging a
 * dependency into the repo.
 */

import type { LeadFields, GuardDecision, AgentProposal } from "../domain/types.js";

export type Role = "lead" | "agent" | "system";

export interface TranscriptEntry {
  role: Role;
  text: string;
  at: string;
}

/**
 * One record per lead. The transcript is the conversation; `fields` is the
 * accumulated extraction; `decision` is the latest guard verdict. Keeping the
 * last decision on the record means answering "is this lead qualified?" never
 * requires replaying a conversation or calling a model.
 */
export interface LeadSessionRecord {
  leadId: string;
  agentName: string;
  agentVersion: number;
  transcript: TranscriptEntry[];
  fields: LeadFields;
  lastProposal: AgentProposal | null;
  decision: GuardDecision | null;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  get(leadId: string): Promise<LeadSessionRecord | null>;
  put(record: LeadSessionRecord): Promise<void>;
  delete(leadId: string): Promise<void>;
  /** Mostly for tests and the demo; a real store would paginate. */
  list(): Promise<LeadSessionRecord[]>;
}

export class InMemoryStore implements Store {
  readonly #records = new Map<string, LeadSessionRecord>();

  async get(leadId: string): Promise<LeadSessionRecord | null> {
    const found = this.#records.get(leadId);
    // Deep-copy on the way out so callers cannot mutate stored state by
    // accident - the same guarantee a network-backed store gives for free.
    return found ? structuredClone(found) : null;
  }

  async put(record: LeadSessionRecord): Promise<void> {
    this.#records.set(record.leadId, structuredClone(record));
  }

  async delete(leadId: string): Promise<void> {
    this.#records.delete(leadId);
  }

  async list(): Promise<LeadSessionRecord[]> {
    return [...this.#records.values()].map((r) => structuredClone(r));
  }
}

export { type RedisLikeClient } from "./redis.js";
