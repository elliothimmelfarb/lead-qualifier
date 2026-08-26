#!/usr/bin/env tsx
/**
 * Validate the agent artifact and write the lock the app checks at startup.
 *
 *   npm run provision         validate and (re)write agents/qualifier.lock.json
 *   npm run provision:check   validate only - non-zero exit if drifted (CI)
 */

import { writeFileSync } from "node:fs";
import {
  AGENT_LOCK_PATH,
  AgentValidationError,
  readAgentLock,
  readAgentSpec,
  type AgentLock,
} from "../src/agent/spec.js";

const checkOnly = process.argv.includes("--check");

try {
  const spec = readAgentSpec();
  const lock = readAgentLock();
  const inSync = lock !== null && lock.digest === spec.digest;

  if (checkOnly) {
    if (!inSync) {
      throw new AgentValidationError(
        lock === null
          ? "No lock file. Run `npm run provision` and commit the result."
          : `Lock is stale (locked v${lock.version}, on disk v${spec.version}). ` +
              "Run `npm run provision` and commit the result.",
      );
    }
    console.log(
      `OK  ${spec.name} v${spec.version} validated and in sync (${spec.digest.slice(0, 12)})`,
    );
    process.exit(0);
  }

  const next: AgentLock = {
    name: spec.name,
    version: spec.version,
    digest: spec.digest,
    provisionedAt: new Date().toISOString(),
  };
  writeFileSync(AGENT_LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    inSync
      ? `OK  ${spec.name} v${spec.version} already in sync; lock refreshed.`
      : `OK  provisioned ${spec.name} v${spec.version} (${spec.digest.slice(0, 12)})`,
  );
  console.log(`    model=${spec.model} temperature=${spec.temperature}`);
} catch (err) {
  if (err instanceof AgentValidationError) {
    console.error(`FAIL  ${err.message}`);
    process.exit(1);
  }
  throw err;
}
