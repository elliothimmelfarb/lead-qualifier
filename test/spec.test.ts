import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentValidationError,
  loadAgentSpec,
  readAgentSpec,
  readAgentLock,
  AGENT_YAML_PATH,
} from "../src/agent/spec.js";

/** Build a throwaway agent directory so tests never touch the real artifact. */
function scratchAgent(yaml: string, prompt = "You are a test agent.") {
  const dir = mkdtempSync(join(tmpdir(), "lead-qualifier-"));
  mkdirSync(join(dir, "prompts"));
  writeFileSync(join(dir, "prompts", "system.md"), prompt);
  const yamlPath = join(dir, "agent.yaml");
  writeFileSync(yamlPath, yaml);
  return { dir, yamlPath, lockPath: join(dir, "agent.lock.json") };
}

const VALID_YAML = `
name: test-agent
version: 2
model: claude-sonnet-5
temperature: 0.3
maxTokens: 512
systemPrompt: prompts/system.md
description: A test agent.
`;

describe("the shipped agent artifact", () => {
  it("validates and is in sync with its lock", () => {
    const spec = loadAgentSpec();
    expect(spec.name).toBe("summit-trails-qualifier");
    expect(spec.systemPromptText).toMatch(/Summit Trails/);
    const lock = readAgentLock();
    expect(lock?.digest).toBe(spec.digest);
    expect(lock?.version).toBe(spec.version);
  });

  it("points at a real prompt file", () => {
    expect(readAgentSpec(AGENT_YAML_PATH).systemPromptText.length).toBeGreaterThan(
      200,
    );
  });
});

describe("schema validation", () => {
  it("accepts a well-formed artifact", () => {
    const { yamlPath } = scratchAgent(VALID_YAML);
    expect(readAgentSpec(yamlPath).version).toBe(2);
  });

  it("rejects an unknown key rather than silently ignoring it", () => {
    const { yamlPath } = scratchAgent(`${VALID_YAML}\ntemprature: 0.9\n`);
    expect(() => readAgentSpec(yamlPath)).toThrow(AgentValidationError);
  });

  it.each([
    ["a missing version", VALID_YAML.replace(/version: 2\n/, "")],
    ["a non-integer version", VALID_YAML.replace("version: 2", "version: 2.5")],
    ["a temperature above 1", VALID_YAML.replace("temperature: 0.3", "temperature: 2")],
    ["an upper-case name", VALID_YAML.replace("test-agent", "TestAgent")],
    ["maxTokens below the floor", VALID_YAML.replace("maxTokens: 512", "maxTokens: 8")],
  ])("rejects %s", (_label, yaml) => {
    const { yamlPath } = scratchAgent(yaml);
    expect(() => readAgentSpec(yamlPath)).toThrow(AgentValidationError);
  });

  it("rejects a systemPrompt path that does not exist", () => {
    const { yamlPath } = scratchAgent(
      VALID_YAML.replace("prompts/system.md", "prompts/nope.md"),
    );
    expect(() => readAgentSpec(yamlPath)).toThrow(/does not exist/);
  });

  it("rejects an empty prompt file", () => {
    const { yamlPath } = scratchAgent(VALID_YAML, "   \n");
    expect(() => readAgentSpec(yamlPath)).toThrow(/is empty/);
  });
});

describe("the app refuses to run against an unvalidated version", () => {
  it("throws when the agent has never been provisioned", () => {
    const { yamlPath, lockPath } = scratchAgent(VALID_YAML);
    expect(() => loadAgentSpec(yamlPath, lockPath)).toThrow(
      /never been provisioned/,
    );
  });

  it("throws when the YAML has drifted from the lock", () => {
    const { yamlPath, lockPath } = scratchAgent(VALID_YAML);
    const spec = readAgentSpec(yamlPath);
    writeFileSync(
      lockPath,
      JSON.stringify({
        name: spec.name,
        version: spec.version,
        digest: spec.digest,
        provisionedAt: new Date().toISOString(),
      }),
    );
    expect(() => loadAgentSpec(yamlPath, lockPath)).not.toThrow();

    // Edit the prompt without re-provisioning: the digest no longer matches.
    writeFileSync(join(yamlPath, "..", "prompts", "system.md"), "Different!");
    expect(() => loadAgentSpec(yamlPath, lockPath)).toThrow(/drifted/);
  });

  it("detects a YAML-only change too", () => {
    const { yamlPath, lockPath } = scratchAgent(VALID_YAML);
    const spec = readAgentSpec(yamlPath);
    writeFileSync(
      lockPath,
      JSON.stringify({
        name: spec.name,
        version: spec.version,
        digest: spec.digest,
        provisionedAt: new Date().toISOString(),
      }),
    );
    writeFileSync(yamlPath, VALID_YAML.replace("temperature: 0.3", "temperature: 0.9"));
    expect(() => loadAgentSpec(yamlPath, lockPath)).toThrow(/drifted/);
  });
});
