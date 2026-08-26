/**
 * The persona simulation harness.
 *
 * Plays a scripted lead against the real session, the real guard and the real
 * store, swapping only the model. That is the trick that makes this an
 * integration test rather than a mock-fest: everything under test is production
 * code, and the only substituted component is the one that costs money and
 * returns something different every time.
 *
 * With ANTHROPIC_API_KEY set you can pass the Anthropic model instead and run
 * the identical personas against the live agent - same fixtures, same
 * assertions, no rewrite.
 */

import { LeadSession, type Clock, type Turn } from "../src/agent/session.js";
import { MockQualifierModel } from "../src/agent/mockModel.js";
import type { QualifierModel } from "../src/agent/model.js";
import { loadAgentSpec, type LoadedAgent } from "../src/agent/spec.js";
import { InMemoryStore, type Store } from "../src/store/index.js";
import type { GuardDecision } from "../src/domain/types.js";
import type { Persona } from "./personas/index.js";

export interface SimOptions {
  agent?: LoadedAgent;
  model?: QualifierModel;
  store?: Store;
  /** Frozen so date-window rules evaluate identically on every run. */
  today?: Date;
}

export interface SimResult {
  persona: Persona;
  turns: Turn[];
  decision: GuardDecision;
  /** True if any turn was an override - used to assert the guard did the work. */
  sawOverride: boolean;
}

function fixedClock(today: Date): Clock {
  return { now: () => today };
}

export async function playPersona(
  persona: Persona,
  options: SimOptions = {},
): Promise<SimResult> {
  const agent = options.agent ?? loadAgentSpec();
  const model = options.model ?? new MockQualifierModel();
  const store = options.store ?? new InMemoryStore();
  const today = options.today ?? new Date();

  const session = new LeadSession(`sim-${persona.id}`, {
    agent,
    model,
    store,
    clock: fixedClock(today),
  });

  const turns: Turn[] = [];
  let sawOverride = false;

  for (const message of persona.messages(today)) {
    const turn = await session.send(message);
    turns.push(turn);
    if (turn.overrideNote !== null) sawOverride = true;
    // A disqualification is terminal. Stop the script rather than pretending a
    // real system would keep interviewing someone it has already declined.
    if (turn.decision.verdict === "disqualified") break;
  }

  const last = turns.at(-1);
  if (!last) {
    throw new Error(`Persona "${persona.id}" has no messages`);
  }
  return { persona, turns, decision: last.decision, sawOverride };
}

export async function playAll(options: SimOptions = {}): Promise<SimResult[]> {
  const { PERSONAS } = await import("./personas/index.js");
  const results: SimResult[] = [];
  for (const persona of PERSONAS) {
    results.push(await playPersona(persona, options));
  }
  return results;
}
