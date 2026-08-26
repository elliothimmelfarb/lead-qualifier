/**
 * Exhaustive tests for the guard. This is the file to read first: it is the
 * complete, executable specification of who Summit Trails will talk to.
 */

import { describe, expect, it } from "vitest";
import {
  RULES,
  checkRules,
  decide,
  leadTimeDays,
  missingFields,
  overrideNote,
} from "../src/domain/qualification.js";
import type { AgentProposal, LeadFields } from "../src/domain/types.js";

const TODAY = new Date("2026-03-01T00:00:00Z");

function iso(daysFromToday: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function fields(overrides: Partial<LeadFields> = {}): LeadFields {
  return {
    budgetPerPersonUsd: 2_000,
    groupSize: 4,
    startDateIso: iso(90),
    fitnessLevel: "moderate",
    ...overrides,
  };
}

function proposal(
  f: LeadFields,
  proposedQualified: boolean,
): AgentProposal {
  return { fields: f, proposedQualified, rationale: "test" };
}

describe("leadTimeDays", () => {
  it("counts whole days in UTC", () => {
    expect(leadTimeDays(iso(0), TODAY)).toBe(0);
    expect(leadTimeDays(iso(1), TODAY)).toBe(1);
    expect(leadTimeDays(iso(365), TODAY)).toBe(365);
  });

  it("is unaffected by the time of day the request arrives", () => {
    const lateInDay = new Date("2026-03-01T23:59:59Z");
    expect(leadTimeDays(iso(30), lateInDay)).toBe(30);
  });

  it("returns negative for past dates", () => {
    expect(leadTimeDays(iso(-5), TODAY)).toBe(-5);
  });

  it.each(["not-a-date", "2026-13-01", "01-03-2026", "2026-3-1", ""])(
    "rejects %j",
    (bad) => {
      expect(leadTimeDays(bad, TODAY)).toBeNull();
    },
  );
});

describe("missingFields", () => {
  it("is empty when everything is known", () => {
    expect(missingFields(fields())).toEqual([]);
  });

  it("lists every null field in ask order", () => {
    expect(
      missingFields({
        budgetPerPersonUsd: null,
        groupSize: null,
        startDateIso: null,
        fitnessLevel: null,
      }),
    ).toEqual([
      "budgetPerPersonUsd",
      "groupSize",
      "startDateIso",
      "fitnessLevel",
    ]);
  });

  it("treats 0 as known, not missing", () => {
    // 0 is a *bad* group size, which is a rule violation, not an absence.
    expect(missingFields(fields({ groupSize: 0 }))).toEqual([]);
  });
});

describe("checkRules - budget floor", () => {
  it("passes exactly at the floor (inclusive)", () => {
    expect(
      checkRules(fields({ budgetPerPersonUsd: RULES.budgetFloorUsd }), TODAY),
    ).toEqual([]);
  });

  it("fails one dollar under the floor", () => {
    const v = checkRules(
      fields({ budgetPerPersonUsd: RULES.budgetFloorUsd - 1 }),
      TODAY,
    );
    expect(v.map((x) => x.rule)).toEqual(["budget_floor"]);
  });

  it("skips the rule when the budget is unknown", () => {
    expect(checkRules(fields({ budgetPerPersonUsd: null }), TODAY)).toEqual([]);
  });
});

describe("checkRules - group size cap", () => {
  it("passes at 1 and at the cap", () => {
    expect(checkRules(fields({ groupSize: 1 }), TODAY)).toEqual([]);
    expect(
      checkRules(fields({ groupSize: RULES.groupSizeCap }), TODAY),
    ).toEqual([]);
  });

  it("fails one over the cap", () => {
    const v = checkRules(
      fields({ groupSize: RULES.groupSizeCap + 1 }),
      TODAY,
    );
    expect(v.map((x) => x.rule)).toEqual(["group_size_cap"]);
    expect(v[0]?.message).toMatch(/charters/);
  });

  it.each([0, -3])("fails on a nonsense size (%i)", (n) => {
    expect(checkRules(fields({ groupSize: n }), TODAY).map((x) => x.rule)).toEqual(
      ["group_size_cap"],
    );
  });

  it("skips the rule when group size is unknown", () => {
    expect(checkRules(fields({ groupSize: null }), TODAY)).toEqual([]);
  });
});

describe("checkRules - date window", () => {
  it("passes exactly at both boundaries (inclusive)", () => {
    expect(
      checkRules(fields({ startDateIso: iso(RULES.minLeadDays) }), TODAY),
    ).toEqual([]);
    expect(
      checkRules(fields({ startDateIso: iso(RULES.maxLeadDays) }), TODAY),
    ).toEqual([]);
  });

  it("fails one day inside the minimum lead time", () => {
    const v = checkRules(
      fields({ startDateIso: iso(RULES.minLeadDays - 1) }),
      TODAY,
    );
    expect(v.map((x) => x.rule)).toEqual(["date_window"]);
    expect(v[0]?.message).toMatch(/minimum/);
  });

  it("fails one day past the booking horizon", () => {
    const v = checkRules(
      fields({ startDateIso: iso(RULES.maxLeadDays + 1) }),
      TODAY,
    );
    expect(v.map((x) => x.rule)).toEqual(["date_window"]);
    expect(v[0]?.message).toMatch(/horizon/);
  });

  it("fails on a date in the past", () => {
    expect(
      checkRules(fields({ startDateIso: iso(-1) }), TODAY).map((x) => x.rule),
    ).toEqual(["date_window"]);
  });

  it("fails on an unparseable date rather than ignoring it", () => {
    const v = checkRules(fields({ startDateIso: "next spring" }), TODAY);
    expect(v.map((x) => x.rule)).toEqual(["date_window"]);
    expect(v[0]?.message).toMatch(/not a usable date/);
  });

  it("skips the rule when the date is unknown", () => {
    expect(checkRules(fields({ startDateIso: null }), TODAY)).toEqual([]);
  });
});

describe("checkRules - multiple violations", () => {
  it("reports every broken rule, not just the first", () => {
    const v = checkRules(
      fields({
        budgetPerPersonUsd: 100,
        groupSize: 50,
        startDateIso: iso(2),
      }),
      TODAY,
    );
    expect(v.map((x) => x.rule).sort()).toEqual([
      "budget_floor",
      "date_window",
      "group_size_cap",
    ]);
  });
});

describe("decide - the agent proposes, code decides", () => {
  it("qualifies when rules pass and the agent says yes", () => {
    const d = decide({ proposal: proposal(fields(), true), today: TODAY });
    expect(d.verdict).toBe("qualified");
    expect(d.overrodeAgent).toBe(false);
  });

  it("lets the agent NARROW: rules pass but the agent says no", () => {
    const d = decide({ proposal: proposal(fields(), false), today: TODAY });
    expect(d.verdict).toBe("not_qualified");
    expect(d.overrodeAgent).toBe(false);
    expect(d.violations).toEqual([]);
  });

  it("never lets the agent WIDEN: a rule violation beats a 'yes'", () => {
    const d = decide({
      proposal: proposal(fields({ budgetPerPersonUsd: 50 }), true),
      today: TODAY,
    });
    expect(d.verdict).toBe("disqualified");
    expect(d.overrodeAgent).toBe(true);
    expect(d.explanation).toMatch(/overruled by hard rules/);
  });

  it("records no override when the agent already agreed it was a no", () => {
    const d = decide({
      proposal: proposal(fields({ budgetPerPersonUsd: 50 }), false),
      today: TODAY,
    });
    expect(d.verdict).toBe("disqualified");
    expect(d.overrodeAgent).toBe(false);
  });

  it("is incomplete when a field is missing and no rule is broken", () => {
    const d = decide({
      proposal: proposal(fields({ fitnessLevel: null }), false),
      today: TODAY,
    });
    expect(d.verdict).toBe("incomplete");
    expect(d.missingFields).toEqual(["fitnessLevel"]);
  });

  it("refuses to qualify on incomplete data even when the agent says yes", () => {
    const d = decide({
      proposal: proposal(fields({ groupSize: null }), true),
      today: TODAY,
    });
    expect(d.verdict).toBe("incomplete");
  });

  it("prefers disqualification over incompleteness", () => {
    // Already disqualifying on budget, and still missing fitness. There is no
    // point interviewing further, so the terminal answer wins.
    const d = decide({
      proposal: proposal(
        fields({ budgetPerPersonUsd: 10, fitnessLevel: null }),
        true,
      ),
      today: TODAY,
    });
    expect(d.verdict).toBe("disqualified");
    expect(d.missingFields).toEqual([]);
  });

  it("is a pure function of its inputs", () => {
    const input = { proposal: proposal(fields(), true), today: TODAY };
    expect(decide(input)).toEqual(decide(input));
  });

  it("does not mutate the fields it is given", () => {
    const f = fields();
    const snapshot = structuredClone(f);
    decide({ proposal: proposal(f, true), today: TODAY });
    expect(f).toEqual(snapshot);
  });
});

describe("overrideNote", () => {
  it("is null unless the guard actually overruled the agent", () => {
    expect(
      overrideNote(decide({ proposal: proposal(fields(), true), today: TODAY })),
    ).toBeNull();
    expect(
      overrideNote(
        decide({ proposal: proposal(fields(), false), today: TODAY }),
      ),
    ).toBeNull();
  });

  it("names every violated rule so the model can explain itself", () => {
    const d = decide({
      proposal: proposal(
        fields({ budgetPerPersonUsd: 100, groupSize: 40 }),
        true,
      ),
      today: TODAY,
    });
    const note = overrideNote(d);
    expect(note).toContain("DISQUALIFIED");
    expect(note).toContain("below the $1200 floor");
    expect(note).toContain("exceeds the cap");
    expect(note).toContain("Do not book a call");
  });
});
