import { describe, expect, it } from "vitest";
import { InMemoryStore, type LeadSessionRecord } from "../src/store/index.js";
import { EMPTY_FIELDS } from "../src/domain/types.js";

function record(leadId: string): LeadSessionRecord {
  const now = new Date("2026-03-01T00:00:00Z").toISOString();
  return {
    leadId,
    agentName: "test",
    agentVersion: 1,
    transcript: [{ role: "lead", text: "hello", at: now }],
    fields: { ...EMPTY_FIELDS },
    lastProposal: null,
    decision: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("InMemoryStore", () => {
  it("round-trips a record", async () => {
    const store = new InMemoryStore();
    await store.put(record("a"));
    expect((await store.get("a"))?.leadId).toBe("a");
  });

  it("returns null for an unknown lead", async () => {
    expect(await new InMemoryStore().get("nope")).toBeNull();
  });

  it("isolates stored state from caller mutation", async () => {
    const store = new InMemoryStore();
    const original = record("a");
    await store.put(original);

    // Mutating either the object we passed in or the one we got back must not
    // corrupt the store - the same guarantee a network store gives for free.
    original.transcript.push({ role: "lead", text: "sneaky", at: "" });
    const fetched = await store.get("a");
    fetched?.transcript.push({ role: "lead", text: "also sneaky", at: "" });

    expect((await store.get("a"))?.transcript).toHaveLength(1);
  });

  it("overwrites on repeated put", async () => {
    const store = new InMemoryStore();
    await store.put(record("a"));
    const updated = { ...record("a"), agentVersion: 9 };
    await store.put(updated);
    expect((await store.get("a"))?.agentVersion).toBe(9);
    expect(await store.list()).toHaveLength(1);
  });

  it("deletes", async () => {
    const store = new InMemoryStore();
    await store.put(record("a"));
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    await store.delete("a"); // idempotent
  });

  it("lists every record", async () => {
    const store = new InMemoryStore();
    await store.put(record("a"));
    await store.put(record("b"));
    expect((await store.list()).map((r) => r.leadId).sort()).toEqual(["a", "b"]);
  });
});
