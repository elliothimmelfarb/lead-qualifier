/**
 * The scripted stand-in for the real model.
 *
 * It is not trying to be a language model. It is trying to be a *deterministic
 * substitute with the same interface and the same failure modes* - it extracts
 * fields by regex, asks for the next missing one, and is optimistic about
 * qualification exactly the way a real model is. That last property is what
 * makes the sim suite meaningful: the mock proposes "qualified" whenever it has
 * four fields, so every persona that gets disqualified is a persona where the
 * guard actually overruled the agent.
 */

import type { FitnessLevel, LeadFields } from "../domain/types.js";
import { EMPTY_FIELDS } from "../domain/types.js";
import type {
  ModelReply,
  ModelRequest,
  QualifierModel,
} from "./model.js";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
};

function extractBudget(text: string): number | null {
  // Require an explicit currency marker or per-person phrasing so a group size
  // never gets read as a budget.
  const dollar = /\$\s?([\d,]+)/.exec(text);
  if (dollar?.[1]) return Number(dollar[1].replace(/,/g, ""));
  const perPerson =
    /\b([\d,]{3,7})\s*(?:usd|dollars|bucks)?\s*(?:per person|per head|pp|each)\b/i.exec(
      text,
    );
  if (perPerson?.[1]) return Number(perPerson[1].replace(/,/g, ""));
  return null;
}

function extractGroupSize(text: string): number | null {
  if (/\b(?:just|only)\s+me\b|\bsolo\b|\bby myself\b/i.test(text)) return 1;
  const digits =
    /\b(\d{1,3})\s*(?:of us|people|persons|travell?ers|adults|friends|pax|guests)\b/i.exec(
      text,
    );
  if (digits?.[1]) return Number(digits[1]);
  const words =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)\s+(?:of us|people|persons|travell?ers|adults|friends|guests)\b/i.exec(
      text,
    );
  const word = words?.[1]?.toLowerCase();
  if (word && word in NUMBER_WORDS) return NUMBER_WORDS[word] ?? null;
  return null;
}

function extractDate(text: string): string | null {
  // Only an unambiguous ISO date counts. "Sometime next spring" is explicitly
  // not a date, and the prompt tells the real model the same thing.
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  return iso?.[1] ?? null;
}

function extractFitness(text: string): FitnessLevel | null {
  if (/\b(?:very fit|marathon|ultra|climb|high fitness|expert)\b/i.test(text)) {
    return "high";
  }
  if (/\b(?:beginner|not fit|low fitness|sedentary|desk job)\b/i.test(text)) {
    return "low";
  }
  const explicit =
    /\bfitness(?:\s+level)?\s*(?:is|:|=)?\s*(low|moderate|high)\b/i.exec(text) ??
    /\b(low|moderate|high)\s+fitness\b/i.exec(text);
  const level = explicit?.[1]?.toLowerCase();
  if (level === "low" || level === "moderate" || level === "high") return level;
  if (/\b(?:reasonably fit|average shape|moderately active|hike)\b/i.test(text)) {
    return "moderate";
  }
  return null;
}

/**
 * Extraction is cumulative over the whole conversation, and a field once known
 * is never un-learned. Real models behave this way too when the transcript is
 * in context, and modelling it here keeps the sim honest.
 */
export function extractFields(leadText: string): LeadFields {
  return {
    budgetPerPersonUsd: extractBudget(leadText),
    groupSize: extractGroupSize(leadText),
    startDateIso: extractDate(leadText),
    fitnessLevel: extractFitness(leadText),
  };
}

const QUESTIONS: Record<keyof LeadFields, string> = {
  budgetPerPersonUsd:
    "Roughly what budget per person did you have in mind, excluding flights?",
  groupSize: "How many of you would be travelling?",
  startDateIso:
    "What start date are you looking at? An exact date helps - say 2026-09-14.",
  fitnessLevel:
    "How would you rate the group's fitness - low, moderate, or high?",
};

const ASK_ORDER = [
  "budgetPerPersonUsd",
  "groupSize",
  "startDateIso",
  "fitnessLevel",
] as const;

export class MockQualifierModel implements QualifierModel {
  readonly id = "mock";

  async complete(req: ModelRequest): Promise<ModelReply> {
    const leadText = req.transcript
      .filter((t) => t.role === "lead")
      .map((t) => t.text)
      .join("\n");

    const fields = extractFields(leadText);
    const missing = ASK_ORDER.filter((k) => fields[k] === null);

    // The guard's override note arrives as a `system` transcript entry. A real
    // model reads it and changes tack; the mock does the same, minimally.
    const overridden = req.transcript.some(
      (t) => t.role === "system" && t.text.includes("qualification override"),
    );
    if (overridden) {
      return {
        reply:
          "Thanks for the details - I'm sorry, this one isn't a fit for our guided trips. " +
          "I can point you at our self-guided routes if that helps.",
        fields,
        proposedQualified: false,
        rationale: "Deferring to the qualification override.",
      };
    }

    if (missing.length > 0) {
      const next = missing[0] as keyof LeadFields;
      return {
        reply: QUESTIONS[next],
        fields,
        // Optimistic-but-not-reckless: never proposes qualified on partial data.
        proposedQualified: false,
        rationale: `Still need ${missing.join(", ")}.`,
      };
    }

    return {
      reply:
        "That all sounds workable. Shall I book you a 20-minute call with one of our trip designers?",
      fields,
      // Deliberately optimistic once the form is full - the guard is what says
      // no. See the module comment.
      proposedQualified: true,
      rationale: "All four fields captured.",
    };
  }
}

export const EMPTY: LeadFields = { ...EMPTY_FIELDS };
