/**
 * Personas are DATA, not test code.
 *
 * Each one is a scripted lead: a queue of things they say, plus the verdict the
 * guard is expected to reach. Keeping them as plain data means a non-engineer
 * can add a persona, and means the same fixtures can drive the mock harness
 * today and a live-model eval later without being rewritten.
 *
 * Messages are a function of `today` so that date-sensitive personas (lead time
 * too short, booking horizon too far) stay correct forever instead of rotting
 * into a fixed calendar year.
 */

import type { Verdict } from "../../src/domain/types.js";

export interface Persona {
  id: string;
  label: string;
  /** What the guard must conclude once the script is exhausted. */
  expectedVerdict: Verdict;
  /** True when the model is expected to propose "yes" and be overruled. */
  expectsOverride: boolean;
  notes: string;
  messages: (today: Date) => string[];
}

/** ISO date `n` days after `today`, in UTC. */
export function plusDays(today: Date, n: number): string {
  const d = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const PERSONAS: readonly Persona[] = [
  {
    id: "eager-qualified",
    label: "Eager and qualified",
    expectedVerdict: "qualified",
    expectsOverride: false,
    notes: "The happy path: answers cleanly, clears every rule.",
    messages: (t) => [
      "Hi! We're looking at your Patagonia trek.",
      "Budget is about $2,400 per person, flights aside.",
      "There'd be 4 of us.",
      `We're aiming to start ${plusDays(t, 90)}.`,
      "I'd say moderate fitness across the group.",
    ],
  },
  {
    id: "budget-too-low",
    label: "Budget below the floor",
    expectedVerdict: "disqualified",
    expectsOverride: true,
    notes:
      "Discloses the low budget last, so the model has a full form and proposes yes. The budget floor overrules it.",
    messages: (t) => [
      "Interested in a guided trek.",
      "3 of us travelling.",
      `Start date ${plusDays(t, 120)}.`,
      "We're all very fit, we run ultras.",
      "We can do about $650 per person.",
    ],
  },
  {
    id: "vague-dates",
    label: "Vague about dates",
    expectedVerdict: "incomplete",
    expectsOverride: false,
    notes:
      "Answers everything except the date. 'Next spring-ish' must not be coerced into a date.",
    messages: () => [
      "Thinking about a trip with friends.",
      "We'd spend maybe $3,100 per person.",
      "6 of us, give or take.",
      "Sometime next spring? Or possibly autumn, we're flexible.",
      "Fitness is moderate.",
      "Really we just want to go whenever the weather is nicest.",
    ],
  },
  {
    id: "chatty-unqualified",
    label: "Chatty, group too large",
    expectedVerdict: "disqualified",
    expectsOverride: true,
    notes:
      "Buries the disqualifying fact (a 20-person party) in friendly noise. The cap catches it.",
    messages: (t) => [
      "Hello there! Long-time follower of your Instagram, the Dolomites photos are unreal.",
      "So my sister got married last year and the whole extended family caught the travel bug, which is a whole story.",
      "Anyway budget's not really the issue, we're comfortable at $3,000 per person.",
      `Looking at ${plusDays(t, 150)} because that's school holidays.`,
      "Fitness is moderate, mostly. Uncle Ray less so.",
      "Oh, and there would be 20 of us — cousins, in-laws, the lot.",
    ],
  },
  {
    id: "hostile",
    label: "Hostile and evasive",
    expectedVerdict: "incomplete",
    expectsOverride: false,
    notes:
      "Refuses to answer. Must never be qualified, and must never be disqualified either - there is nothing to disqualify on.",
    messages: () => [
      "Why does a hiking company need my life story?",
      "I'm not telling a chatbot my finances.",
      "Just send me the prices like a normal business.",
      "This is exactly why I hate these things.",
    ],
  },
  {
    id: "non-native-speaker",
    label: "Non-native speaker, fully qualified",
    expectedVerdict: "qualified",
    expectsOverride: false,
    notes:
      "Broken grammar, complete information. Qualification must not depend on fluent English.",
    messages: (t) => [
      "Hello, we want make trekking with you please.",
      "Money we have is $1,900 per person, this is okay?",
      "We are 5 people, all friends from work.",
      `Date we want is ${plusDays(t, 200)}.`,
      "We walk mountains every month, fitness is high.",
    ],
  },
  {
    id: "tire-kicker",
    label: "Tire-kicker, outside the booking horizon",
    expectedVerdict: "disqualified",
    expectsOverride: true,
    notes:
      "Answers everything but wants a date two years out, past the horizon where routes and pricing exist.",
    messages: (t) => [
      "Not committing to anything, just window shopping for someday.",
      "I guess $1,800 per person would be fine.",
      "2 of us.",
      "Moderate fitness I suppose.",
      `Thinking ${plusDays(t, 700)}, roughly.`,
    ],
  },
  {
    id: "edge-case-exactly-at-budget-floor",
    label: "Exactly at the budget floor",
    expectedVerdict: "qualified",
    expectsOverride: false,
    notes:
      "The floor is inclusive. This persona exists to pin that boundary so a future refactor cannot quietly flip it to exclusive.",
    messages: (t) => [
      "Can we do one of your treks on a tight budget?",
      "We have exactly $1,200 per person.",
      "2 of us.",
      `We'd go ${plusDays(t, 60)}.`,
      "Fitness is high, we hike most weekends.",
    ],
  },
] as const;
