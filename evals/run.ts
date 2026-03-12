/* eslint-disable no-console */
/**
 * CLI entry point for running evals.
 *
 * Usage:
 *   npx tsx evals/run.ts                   # run all scenarios
 *   npx tsx evals/run.ts identity bulk     # run matching scenarios
 *
 * Results are saved to evals/results/<promptVersion>-<timestamp>.json
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClaudeClient } from "../lib/clients.js";
import { runScenario } from "./eval-harness.js";
import type { EvalResult, EvalScenario, AssertionResult } from "./eval-harness.js";
import { SCENARIOS } from "./scenarios.js";
import { PROMPT_VERSION } from "../lib/agent.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY required in .env");
  process.exit(1);
}

const claude = createClaudeClient(apiKey);

const filter = process.argv.slice(2);
const scenarios = filter.length > 0
  ? SCENARIOS.filter((s) => filter.some((f) => s.name.includes(f)))
  : SCENARIOS;

if (scenarios.length === 0) {
  console.error("No scenarios matched filter:", filter.join(", "));
  process.exit(1);
}

console.log("Prompt " + PROMPT_VERSION + " — running " + String(scenarios.length) + " eval(s)...\n");

function formatFailure(f: AssertionResult): string {
  const suffix = f.detail ? " — " + f.detail : "";
  return "    x " + f.assertion + suffix;
}

async function runOne(scenario: EvalScenario): Promise<EvalResult> {
  process.stdout.write("  " + scenario.name + ": ");
  try {
    const result = await runScenario(claude, scenario);
    if (result.failed.length === 0) {
      console.log("PASS (" + String(result.passed.length) + " assertions, " + String(result.durationMs) + "ms)");
    } else {
      const total = String(result.passed.length + result.failed.length);
      console.log("FAIL (" + String(result.failed.length) + "/" + total + " failed)");
      result.failed.forEach((f) => { console.log(formatFailure(f)); });
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("ERROR: " + msg);
    return {
      scenario: scenario.name, response: "", toolCalls: [], calendarEvents: [],
      passed: [], failed: [{ assertion: "scenario ran without error", passed: false, detail: msg }],
      durationMs: 0,
    };
  }
}

const results: EvalResult[] = [];
for (const scenario of scenarios) {
  results.push(await runOne(scenario));
}

// Summary
const totalPassed = results.filter((r) => r.failed.length === 0).length;
const totalFailed = results.filter((r) => r.failed.length > 0).length;
console.log("\nResults: " + String(totalPassed) + " passed, " + String(totalFailed) + " failed out of " + String(results.length) + " scenarios");

// Save results artifact
const artifact = {
  promptVersion: PROMPT_VERSION,
  model: "claude-sonnet-4-20250514",
  timestamp: new Date().toISOString(),
  summary: { total: results.length, passed: totalPassed, failed: totalFailed },
  scenarios: results.map((r) => ({
    name: r.scenario,
    passed: r.failed.length === 0,
    assertions: { passed: r.passed.length, failed: r.failed.length },
    durationMs: r.durationMs,
    failures: r.failed.map((f) => f.assertion),
  })),
};

const dir = "evals/results";
mkdirSync(dir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
const filename = dir + "/" + PROMPT_VERSION + "-" + ts + ".json";
writeFileSync(filename, JSON.stringify(artifact, null, 2) + "\n");
console.log("Results saved to " + filename);

if (totalFailed > 0) {
  process.exit(1);
}
