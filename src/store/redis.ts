/**
 * Redis implementation - SKETCH ONLY, deliberately not wired up.
 *
 * The point of this file is to prove the `Store` seam costs nothing to cross.
 * It is commented out rather than implemented so that `npm test` and `npm run
 * demo` stay credential-free: the moment this repo has a live Redis import,
 * "clone and run" stops being true.
 *
 * To make it real: `npm i redis`, delete the comment markers, and pass a client
 * into `new RedisStore(client)` instead of `new InMemoryStore()`. Nothing else
 * in the codebase changes - that is the test of whether the seam was in the
 * right place.
 */

/** The slice of a Redis client this store would need. */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/*
import type { LeadSessionRecord, Store } from "./index.js";

const KEY_PREFIX = "lead-qualifier:session:";
// Inbound leads go stale; let the store expire them rather than writing a
// reaper job. Thirty days is the window a trip designer might still follow up.
const TTL_SECONDS = 60 * 60 * 24 * 30;

export class RedisStore implements Store {
  constructor(private readonly client: RedisLikeClient) {}

  #key(leadId: string): string {
    return `${KEY_PREFIX}${leadId}`;
  }

  async get(leadId: string): Promise<LeadSessionRecord | null> {
    const raw = await this.client.get(this.#key(leadId));
    // A real implementation would validate with zod here rather than trusting
    // JSON.parse: stored records outlive the code that wrote them, so an old
    // record shape is a routine event, not an exceptional one.
    return raw === null ? null : (JSON.parse(raw) as LeadSessionRecord);
  }

  async put(record: LeadSessionRecord): Promise<void> {
    await this.client.set(this.#key(record.leadId), JSON.stringify(record), {
      EX: TTL_SECONDS,
    });
  }

  async delete(leadId: string): Promise<void> {
    await this.client.del(this.#key(leadId));
  }

  async list(): Promise<LeadSessionRecord[]> {
    // KEYS is O(n) and blocks the server; production would SCAN, or keep an
    // index set alongside the records.
    const keys = await this.client.keys(`${KEY_PREFIX}*`);
    const raws = await Promise.all(keys.map((k) => this.client.get(k)));
    return raws.filter((r): r is string => r !== null).map((r) => JSON.parse(r));
  }
}
*/
