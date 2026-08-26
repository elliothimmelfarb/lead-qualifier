#!/usr/bin/env tsx
/**
 * Console demo: plays one persona and prints the transcript with the guard's
 * decision annotated after every turn.
 *
 *   npm run demo                          # default persona, mock model
 *   npm run demo -- budget-too-low        # pick a persona
 *   npm run demo -- --list                # show the persona set
 *   npm run demo -- --live eager-qualified  # use the real model (needs a key)
 *
 * With no ANTHROPIC_API_KEY set this runs entirely offline against the mock
 * model. That is the point: a reference architecture nobody can run is a
 * diagram.
 */

import { AnthropicQualifierModel } from "./agent/anthropicModel.js";
import { MockQualifierModel } from "./agent/mockModel.js";
import type { QualifierModel } from "./agent/model.js";
import { LeadSession } from "./agent/session.js";
import { AgentValidationError, loadAgentSpec } from "./agent/spec.js";
import { InMemoryStore } from "./store/index.js";
import type { GuardDecision } from "./domain/types.js";
import { PERSONAS } from "../sim/personas/index.js";

const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";
const COLOR: Record<GuardDecision["verdict"], string> = {
  qualified: "\u001b[32m",
  not_qualified: "\u001b[33m",
  disqualified: "\u001b[31m",
  incomplete: "\u001b[36m",
};

function wrap(text: string, indent: string, width = 76): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log(`${BOLD}Personas${RESET}`);
    for (const p of PERSONAS) {
      console.log(
        `  ${p.id.padEnd(36)} ${COLOR[p.expectedVerdict]}${p.expectedVerdict}${RESET}`,
      );
      console.log(wrap(p.notes, "    " + DIM) + RESET);
    }
    return;
  }

  const live = args.includes("--live");
  const wanted = args.find((a) => !a.startsWith("--")) ?? "budget-too-low";
  const persona = PERSONAS.find((p) => p.id === wanted);
  if (!persona) {
    console.error(`Unknown persona "${wanted}". Try: npm run demo -- --list`);
    process.exit(1);
  }

  // Loading the agent is where the version check happens. If the artifact has
  // drifted from its lock, the demo refuses to start.
  const agent = loadAgentSpec();

  let model: QualifierModel;
  if (live) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.error("--live needs ANTHROPIC_API_KEY in the environment.");
      process.exit(1);
    }
    model = new AnthropicQualifierModel(agent);
  } else {
    model = new MockQualifierModel();
  }

  const today = new Date();
  const session = new LeadSession(`demo-${persona.id}`, {
    agent,
    model,
    store: new InMemoryStore(),
    clock: { now: () => today },
  });

  console.log(
    `${BOLD}Summit Trails - lead qualification demo${RESET}\n` +
      `${DIM}agent ${agent.name} v${agent.version} | model ${model.id} | persona ${persona.id}${RESET}\n` +
      `${DIM}expected verdict: ${persona.expectedVerdict}${RESET}\n`,
  );

  for (const message of persona.messages(today)) {
    const turn = await session.send(message);

    console.log(`${BOLD}lead ${RESET}${wrap(turn.leadMessage, "").trim()}`);
    console.log(`${BOLD}agent${RESET} ${wrap(turn.reply, "").trim()}`);

    const d = turn.decision;
    const known = Object.entries(turn.fields)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(
      `${DIM}      guard ${RESET}${COLOR[d.verdict]}${d.verdict.toUpperCase()}${RESET}` +
        `${DIM} ${d.explanation}${RESET}`,
    );
    if (known) console.log(`${DIM}      fields ${known}${RESET}`);
    if (turn.overrideNote) {
      console.log(
        `${COLOR.disqualified}      ** the code overruled the agent **${RESET}`,
      );
    }
    console.log();

    if (turn.decision.verdict === "disqualified") break;
  }

  const final = (await session.record())?.decision;
  console.log(
    `${BOLD}final verdict ${RESET}${COLOR[final!.verdict]}${final!.verdict}${RESET}` +
      (final!.verdict === persona.expectedVerdict ? ` ${DIM}(as expected)${RESET}` : " (UNEXPECTED)"),
  );
}

main().catch((err) => {
  if (err instanceof AgentValidationError) {
    console.error(`Agent artifact problem: ${err.message}`);
    process.exit(1);
  }
  throw err;
});
