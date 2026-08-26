/**
 * THE GUARD — the agent proposes, this code decides.
 *
 * Everything in this file is a pure function of its arguments. No clock, no
 * network, no store, no model. That is deliberate and is the whole point of the
 * architecture: the part of the system that determines who gets a sales call is
 * the part that is fully enumerable, unit-testable, and reviewable by someone
 * who has never heard of an LLM.
 *
 * The model's `proposedQualified` is advisory. It can *narrow* (propose "no"
 * where the rules would allow "yes" — a human-ish judgement call we accept), but
 * it can never *widen*: no proposal can make a lead qualified when a hard rule
 * says otherwise. That asymmetry is the safety property. Violating it is how
 * teams end up with a persuasive stranger talking a model into a $200 booking on
 * a $2,000 trip.
 */

import type {
  AgentProposal,
  GuardDecision,
  LeadFields,
  RuleViolation,
} from "./types.js";

/**
 * Hard business rules. These are constants, not prompt text, because a number
 * in a prompt is a suggestion and a number in code is a rule.
 */
export const RULES = {
  /** Below this, Summit Trails cannot staff a guided trip at margin. */
  budgetFloorUsd: 1_200,
  /** Above this, it is a group charter — a different team and contract. */
  groupSizeCap: 12,
  /** Minimum lead time: permits, guides and porters need booking. */
  minLeadDays: 21,
  /** Beyond this the next season's routes and pricing don't exist yet. */
  maxLeadDays: 400,
} as const;

const REQUIRED_FIELDS = [
  "budgetPerPersonUsd",
  "groupSize",
  "startDateIso",
  "fitnessLevel",
] as const satisfies readonly (keyof LeadFields)[];

const MS_PER_DAY = 86_400_000;

/** Whole days from `today` to `iso`, or `null` if `iso` isn't a real date. */
export function leadTimeDays(iso: string, today: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  // Compare date-to-date in UTC so the answer doesn't wobble with the hour of
  // day the request happens to arrive.
  const start = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.round((target - start) / MS_PER_DAY);
}

/**
 * Apply every hard rule to whatever is known. Fields that are still `null` are
 * skipped rather than treated as failures — "unknown" is not "bad".
 */
export function checkRules(fields: LeadFields, today: Date): RuleViolation[] {
  const violations: RuleViolation[] = [];

  const { budgetPerPersonUsd: budget, groupSize, startDateIso } = fields;

  if (budget !== null && budget < RULES.budgetFloorUsd) {
    violations.push({
      rule: "budget_floor",
      message: `budget $${budget}/person is below the $${RULES.budgetFloorUsd} floor`,
    });
  }

  if (groupSize !== null) {
    if (groupSize < 1) {
      violations.push({
        rule: "group_size_cap",
        message: `group size ${groupSize} is not a real party`,
      });
    } else if (groupSize > RULES.groupSizeCap) {
      violations.push({
        rule: "group_size_cap",
        message: `group of ${groupSize} exceeds the cap of ${RULES.groupSizeCap} — route to charters`,
      });
    }
  }

  if (startDateIso !== null) {
    const days = leadTimeDays(startDateIso, today);
    if (days === null) {
      violations.push({
        rule: "date_window",
        message: `"${startDateIso}" is not a usable date`,
      });
    } else if (days < RULES.minLeadDays) {
      violations.push({
        rule: "date_window",
        message: `${days} days of lead time is under the ${RULES.minLeadDays}-day minimum`,
      });
    } else if (days > RULES.maxLeadDays) {
      violations.push({
        rule: "date_window",
        message: `${days} days out is beyond the ${RULES.maxLeadDays}-day booking horizon`,
      });
    }
  }

  return violations;
}

export function missingFields(fields: LeadFields): (keyof LeadFields)[] {
  return REQUIRED_FIELDS.filter((key) => fields[key] === null);
}

export interface GuardInput {
  proposal: AgentProposal;
  /** Injected, never read from `Date.now()` — see the purity note above. */
  today: Date;
}

/**
 * Decide. Precedence, highest first:
 *
 *   1. A hard-rule violation → `disqualified`, regardless of the proposal.
 *   2. A missing required field → `incomplete`, regardless of the proposal.
 *   3. Otherwise the proposal stands: `qualified` or `not_qualified`.
 *
 * Rules outrank completeness so that a lead who has already told us something
 * disqualifying is not interrogated for three more turns before being told no.
 */
export function decide({ proposal, today }: GuardInput): GuardDecision {
  const { fields, proposedQualified } = proposal;
  const violations = checkRules(fields, today);
  const missing = missingFields(fields);

  if (violations.length > 0) {
    const overrodeAgent = proposedQualified;
    const reasons = violations.map((v) => v.message).join("; ");
    return {
      verdict: "disqualified",
      missingFields: [],
      violations,
      overrodeAgent,
      explanation: overrodeAgent
        ? `Agent proposed qualified; overruled by hard rules: ${reasons}.`
        : `Disqualified by hard rules: ${reasons}.`,
    };
  }

  if (missing.length > 0) {
    return {
      verdict: "incomplete",
      missingFields: missing,
      violations: [],
      // Proposing "qualified" on incomplete data is a model error, not a
      // business-rule conflict, so it is not reported as an override — but the
      // verdict is still `incomplete` and no call gets booked.
      overrodeAgent: false,
      explanation: `Still missing: ${missing.join(", ")}.`,
    };
  }

  return proposedQualified
    ? {
        verdict: "qualified",
        missingFields: [],
        violations: [],
        overrodeAgent: false,
        explanation: "All fields present and every hard rule satisfied.",
      }
    : {
        verdict: "not_qualified",
        missingFields: [],
        violations: [],
        overrodeAgent: false,
        // The agent is allowed to narrow. We record that it did so, because a
        // rise in this verdict is the signal that a prompt change has made the
        // model too conservative.
        explanation:
          "Hard rules satisfied, but the agent declined to qualify this lead.",
      };
}

/**
 * The override, rendered for the model. Feeding the decision back into the
 * transcript is what keeps the conversation and the decision from diverging:
 * the model's next turn is conditioned on what the code actually decided, not
 * on what the model thought it had decided.
 */
export function overrideNote(decision: GuardDecision): string | null {
  if (!decision.overrodeAgent) return null;
  const reasons = decision.violations.map((v) => `- ${v.message}`).join("\n");
  return [
    "SYSTEM NOTE — qualification override.",
    "You proposed this lead as qualified. Deterministic business rules disagree:",
    reasons,
    "The lead is DISQUALIFIED. Do not book a call. Tell them warmly and plainly,",
    "and suggest an alternative if one plausibly fits.",
  ].join("\n");
}
