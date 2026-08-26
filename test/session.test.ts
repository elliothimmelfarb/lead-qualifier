import { beforeAll, describe, expect, it } from "vitest";
import { LeadSession, type Clock } from "../src/agent/session.js";
import { MockQualifierModel } from "../src/agent/mockModel.js";
import type {
  ModelReply,
  ModelRequest,
  QualifierModel,
} from "../src/agent/model.js";
import { loadAgentSpec, type LoadedAgent } from "../src/agent/spec.js";
import { InMemoryStore } from "../src/store/index.js";
import { EMPTY_FIELDS, type LeadFields } from "../src/domain/types.js";

const TODAY = new Date("2026-03-01T00:00:00Z");
const clock: Clock = { now: () => TODAY };

let agent: LoadedAgent;
beforeAll(() => {
  agent = loadAgentSpec();
});

/** A model that replays a fixed script - lets us test session wiring exactly. */
class ScriptedModel implements QualifierModel {
  readonly id = "scripted";
  readonly seen: ModelRequest[] = [];
  #i = 0;
  constructor(private readonly script: ModelReply[]) {}
  async complete(req: ModelRequest): Promise<ModelReply> {
    this.seen.push(structuredClone(req) as ModelRequest);
    const next = this.script[Math.min(this.#i, this.script.length - 1)];
    this.#i += 1;
    if (!next) throw new Error("empty script");
    return next;
  }
}

function reply(
  text: string,
  fields: Partial<LeadFields>,
  proposedQualified = false,
): ModelReply {
  return {
    reply: text,
    fields: { ...EMPTY_FIELDS, ...fields },
    proposedQualified,
    rationale: "",
  };
}

describe("LeadSession", () => {
  it("persists a record on the first turn", async () => {
    const store = new InMemoryStore();
    const session = new LeadSession("lead-1", {
      agent,
      model: new MockQualifierModel(),
      store,
      clock,
    });

    await session.send("Hi, interested in a trek.");
    const record = await store.get("lead-1");

    expect(record).not.toBeNull();
    expect(record?.agentName).toBe(agent.name);
    expect(record?.agentVersion).toBe(agent.version);
    expect(record?.transcript).toHaveLength(2); // lead + agent
    expect(record?.decision?.verdict).toBe("incomplete");
  });

  it("keeps one conversation per lead, isolated from other leads", async () => {
    const store = new InMemoryStore();
    const deps = { agent, model: new MockQualifierModel(), store, clock };

    await new LeadSession("a", deps).send("Budget is $2,000 per person.");
    await new LeadSession("b", deps).send("There are 3 of us.");

    expect((await store.get("a"))?.fields.budgetPerPersonUsd).toBe(2000);
    expect((await store.get("a"))?.fields.groupSize).toBeNull();
    expect((await store.get("b"))?.fields.groupSize).toBe(3);
    expect((await store.get("b"))?.fields.budgetPerPersonUsd).toBeNull();
  });

  it("accumulates fields across turns rather than overwriting with null", async () => {
    const model = new ScriptedModel([
      reply("How many of you?", { budgetPerPersonUsd: 2_500 }),
      // Turn two reports only the group size - the budget must survive.
      reply("When?", { groupSize: 4 }),
    ]);
    const store = new InMemoryStore();
    const session = new LeadSession("lead-2", { agent, model, store, clock });

    await session.send("Budget's 2500 each.");
    const turn = await session.send("Four of us.");

    expect(turn.fields.budgetPerPersonUsd).toBe(2_500);
    expect(turn.fields.groupSize).toBe(4);
  });

  it("passes the full transcript back to the model each turn", async () => {
    const model = new ScriptedModel([reply("ok", {}), reply("ok", {})]);
    const session = new LeadSession("lead-3", {
      agent,
      model,
      store: new InMemoryStore(),
      clock,
    });
    await session.send("first");
    await session.send("second");

    expect(model.seen[0]?.transcript).toHaveLength(1);
    expect(model.seen[1]?.transcript).toHaveLength(3); // lead, agent, lead
    expect(model.seen[1]?.system).toBe(agent.systemPromptText);
  });

  it("injects the guard's override back into the transcript", async () => {
    const model = new ScriptedModel([
      reply(
        "Great, shall I book a call?",
        {
          budgetPerPersonUsd: 300, // below the floor
          groupSize: 2,
          startDateIso: "2026-06-01",
          fitnessLevel: "high",
        },
        true, // the model says yes...
      ),
    ]);
    const store = new InMemoryStore();
    const session = new LeadSession("lead-4", { agent, model, store, clock });

    const turn = await session.send("We've got $300 each.");

    // ...and the code says no.
    expect(turn.decision.verdict).toBe("disqualified");
    expect(turn.decision.overrodeAgent).toBe(true);
    expect(turn.overrideNote).toContain("qualification override");

    const record = await store.get("lead-4");
    const systemEntries = record?.transcript.filter((t) => t.role === "system");
    expect(systemEntries).toHaveLength(1);
    expect(systemEntries?.[0]?.text).toContain("DISQUALIFIED");
  });

  it("short-circuits once a lead is disqualified - no further model calls", async () => {
    const model = new ScriptedModel([
      reply(
        "Sounds good!",
        {
          budgetPerPersonUsd: 100,
          groupSize: 2,
          startDateIso: "2026-06-01",
          fitnessLevel: "high",
        },
        true,
      ),
    ]);
    const session = new LeadSession("lead-5", {
      agent,
      model,
      store: new InMemoryStore(),
      clock,
    });

    await session.send("Budget $100 each.");
    const callsAfterFirst = model.seen.length;
    const second = await session.send("What if we brought more people?");

    expect(model.seen.length).toBe(callsAfterFirst); // model was not consulted
    expect(second.decision.verdict).toBe("disqualified");
  });

  it("reaches a qualified verdict through a full mock conversation", async () => {
    const store = new InMemoryStore();
    const session = new LeadSession("lead-6", {
      agent,
      model: new MockQualifierModel(),
      store,
      clock,
    });

    await session.send("Hi there!");
    await session.send("About $2,200 per person.");
    await session.send("4 of us.");
    await session.send("Start 2026-08-01.");
    const last = await session.send("Fitness is moderate.");

    expect(last.decision.verdict).toBe("qualified");
    expect(last.reply).toMatch(/trip designers/);
    expect((await store.get("lead-6"))?.decision?.verdict).toBe("qualified");
  });
});
