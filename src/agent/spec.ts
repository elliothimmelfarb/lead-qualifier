/**
 * Loading an agent is a validation step, not a file read.
 *
 * `loadAgentSpec()` parses agents/qualifier.agent.yaml, checks it against a zod
 * schema, and then checks it against the lock file written by
 * `npm run provision`. If the YAML has drifted from what was last provisioned,
 * loading throws. The app cannot run against an unvalidated agent version.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");
export const AGENT_YAML_PATH = resolve(REPO_ROOT, "agents/qualifier.agent.yaml");
export const AGENT_LOCK_PATH = resolve(REPO_ROOT, "agents/qualifier.lock.json");

export const agentSpecSchema = z
  .object({
    name: z.string().min(1).regex(/^[a-z0-9-]+$/, "kebab-case identifier"),
    /** Bumped by hand on every semantic change. The lock file pins it. */
    version: z.number().int().positive(),
    model: z.string().min(1),
    temperature: z.number().min(0).max(1),
    maxTokens: z.number().int().min(64).max(8192),
    /** Path to the system prompt, relative to the agent YAML. */
    systemPrompt: z.string().min(1),
    description: z.string().min(1),
  })
  .strict(); // unknown keys are a typo, not a feature

export type AgentSpec = z.infer<typeof agentSpecSchema>;

export interface LoadedAgent extends AgentSpec {
  /** Contents of the referenced prompt file. */
  systemPromptText: string;
  /** Hash over the YAML + prompt. Changing either invalidates the lock. */
  digest: string;
}

export const agentLockSchema = z
  .object({
    name: z.string(),
    version: z.number().int().positive(),
    digest: z.string().length(64),
    provisionedAt: z.string(),
  })
  .strict();

export type AgentLock = z.infer<typeof agentLockSchema>;

export class AgentValidationError extends Error {
  override name = "AgentValidationError";
}

function digestOf(yamlText: string, promptText: string): string {
  return createHash("sha256")
    .update(yamlText)
    .update(" ")
    .update(promptText)
    .digest("hex");
}

/** Parse and schema-validate, without consulting the lock file. */
export function readAgentSpec(yamlPath = AGENT_YAML_PATH): LoadedAgent {
  if (!existsSync(yamlPath)) {
    throw new AgentValidationError(`No agent artifact at ${yamlPath}`);
  }
  const yamlText = readFileSync(yamlPath, "utf8");

  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (cause) {
    throw new AgentValidationError(
      `${yamlPath} is not valid YAML: ${(cause as Error).message}`,
    );
  }

  const parsed = agentSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new AgentValidationError(
      `${yamlPath} failed schema validation:\n${issues}`,
    );
  }

  const promptPath = resolve(dirname(yamlPath), parsed.data.systemPrompt);
  if (!existsSync(promptPath)) {
    throw new AgentValidationError(
      `systemPrompt points at ${promptPath}, which does not exist`,
    );
  }
  const systemPromptText = readFileSync(promptPath, "utf8").trim();
  if (systemPromptText.length === 0) {
    throw new AgentValidationError(`${promptPath} is empty`);
  }

  return {
    ...parsed.data,
    systemPromptText,
    digest: digestOf(yamlText, systemPromptText),
  };
}

export function readAgentLock(lockPath = AGENT_LOCK_PATH): AgentLock | null {
  if (!existsSync(lockPath)) return null;
  const parsed = agentLockSchema.safeParse(
    JSON.parse(readFileSync(lockPath, "utf8")),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * The function the app actually calls. Throws unless the on-disk agent matches
 * a provisioned lock exactly.
 */
export function loadAgentSpec(
  yamlPath = AGENT_YAML_PATH,
  lockPath = AGENT_LOCK_PATH,
): LoadedAgent {
  const spec = readAgentSpec(yamlPath);
  const lock = readAgentLock(lockPath);

  if (lock === null) {
    throw new AgentValidationError(
      `Agent "${spec.name}" has never been provisioned. Run: npm run provision`,
    );
  }
  if (lock.digest !== spec.digest) {
    throw new AgentValidationError(
      `Agent "${spec.name}" v${spec.version} has drifted from the provisioned ` +
        `lock (locked v${lock.version}, digest ${lock.digest.slice(0, 12)}, ` +
        `on disk ${spec.digest.slice(0, 12)}). Bump the version field if this ` +
        `is a semantic change, then run: npm run provision`,
    );
  }
  return spec;
}
