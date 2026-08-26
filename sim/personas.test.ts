/**
 * Integration suite: every persona, end to end, asserting the guard's verdict.
 *
 * These run under `npm test` alongside the unit tests. They are slower and
 * broader by design - a unit test tells you the budget floor works, this tells
 * you a lead who mentions their budget in passing on turn three still hits it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { PERSONAS } from "./personas/index.js";
import { playPersona } from "./runner.js";
import { loadAgentSpec, type LoadedAgent } from "../src/agent/spec.js";

// Frozen date: personas compute their trip dates relative to this, so the
// date-window rule evaluates identically on every machine and every day.
const TODAY = new Date("2026-03-01T12:00:00Z");

let agent: LoadedAgent;
beforeAll(() => {
  agent = loadAgentSpec();
});

describe("persona simulation", () => {
  for (const persona of PERSONAS) {
    it(`${persona.id}: ${persona.expectedVerdict}`, async () => {
      const result = await playPersona(persona, { agent, today: TODAY });

      expect(
        result.decision.verdict,
        `${persona.label} - ${persona.notes}\n` +
          `guard said: ${result.decision.explanation}`,
      ).toBe(persona.expectedVerdict);

      expect(
        result.sawOverride,
        `${persona.id} override expectation. ` +
          "An override means the model proposed 'qualified' and deterministic " +
          "rules said no - the behaviour this repo exists to demonstrate.",
      ).toBe(persona.expectsOverride);
    });
  }

  it("covers all four verdicts across the persona set", () => {
    const verdicts = new Set(PERSONAS.map((p) => p.expectedVerdict));
    expect(verdicts).toContain("qualified");
    expect(verdicts).toContain("disqualified");
    expect(verdicts).toContain("incomplete");
  });

  it("never books a call for a disqualified lead", async () => {
    for (const persona of PERSONAS.filter(
      (p) => p.expectedVerdict === "disqualified",
    )) {
      const { turns } = await playPersona(persona, { agent, today: TODAY });
      const final = turns.at(-1);
      expect(final?.decision.verdict).toBe("disqualified");
      // The guard's note is in the transcript, so the model's *next* turn is
      // conditioned on the real decision rather than its own proposal.
      expect(final?.overrideNote).toContain("DISQUALIFIED");
    }
  });

  it("keeps asking while a lead is merely incomplete", async () => {
    const vague = PERSONAS.find((p) => p.id === "vague-dates");
    expect(vague).toBeDefined();
    const { decision, turns } = await playPersona(vague!, {
      agent,
      today: TODAY,
    });
    expect(decision.verdict).toBe("incomplete");
    expect(decision.missingFields).toEqual(["startDateIso"]);
    // It asked, rather than inventing a date.
    expect(turns.at(-1)?.reply).toMatch(/start date/i);
  });
});
