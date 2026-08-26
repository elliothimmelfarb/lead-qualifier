/** Shared domain vocabulary. No I/O, no SDK types, no framework types. */

export type FitnessLevel = "low" | "moderate" | "high";

/**
 * The four things Summit Trails needs before a trip designer will take a call.
 * `null` means "not yet known" and is distinct from a known-bad value: a lead
 * who hasn't told us their budget is *incomplete*, not *disqualified*.
 */
export interface LeadFields {
  budgetPerPersonUsd: number | null;
  groupSize: number | null;
  startDateIso: string | null;
  fitnessLevel: FitnessLevel | null;
}

export const EMPTY_FIELDS: Readonly<LeadFields> = Object.freeze({
  budgetPerPersonUsd: null,
  groupSize: null,
  startDateIso: null,
  fitnessLevel: null,
});

/** What the model gives us each turn. Everything here is untrusted input. */
export interface AgentProposal {
  fields: LeadFields;
  proposedQualified: boolean;
  rationale: string;
}

export type Verdict =
  /** Every field known and every hard rule satisfied. Book the call. */
  | "qualified"
  /** Every field known, every rule satisfied, but the agent said no. */
  | "not_qualified"
  /** A hard rule failed. Terminal — no amount of conversation changes it. */
  | "disqualified"
  /** Not enough information yet. Keep the conversation going. */
  | "incomplete";

export type RuleId = "budget_floor" | "group_size_cap" | "date_window";

export interface RuleViolation {
  rule: RuleId;
  message: string;
}

export interface GuardDecision {
  verdict: Verdict;
  /** Fields still `null`. Empty unless the verdict is `incomplete`. */
  missingFields: (keyof LeadFields)[];
  violations: RuleViolation[];
  /**
   * True when the agent proposed `qualified` and a hard rule said otherwise.
   * The session feeds this back into the transcript as a system note so the
   * model's next turn is grounded in the decision code actually made.
   */
  overrodeAgent: boolean;
  /** Human-readable trail, safe to log or print in the demo. */
  explanation: string;
}
