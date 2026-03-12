/* eslint-disable no-console */
/**
 * CLI entry point for inference agent evals.
 *
 * Usage:
 *   npx tsx evals/run-inference.ts                    # run all
 *   npx tsx evals/run-inference.ts extract-child       # filter by name
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClaudeClient } from "../lib/clients.js";
import { runInferenceScenario, INFERENCE_SCENARIOS } from "./inference-scenarios.js";
import type { InferenceResult, InferenceScenario } from "./inference-scenarios.js";
import { INFERENCE_VERSION } from "../lib/inference.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY required in .env");
  process.exit(1);
}

const claude = createClaudeClient(apiKey);

const filter = process.argv.slice(2);
const scenarios = filter.length > 0
  ? INFERENCE_SCENARIOS.filter((s) => filter.some((f) => s.name.includes(f)))
  : INFERENCE_SCENARIOS;

if (scenarios.length === 0) {
  console.error("No scenarios matched filter:", filter.join(", "));
  process.exit(1);
}

console.log("Inference " + INFERENCE_VERSION + " — running " + String(scenarios.length) + " eval(s)...\n");

async function runOne(scenario: InferenceScenario): Promise<InferenceResult> {
  process.stdout.write("  " + scenario.name + ": ");
  try {
    const result = await runInferenceScenario(claude, scenario);
    if (result.failed.length === 0) {
      const keys = result.writes.map((w) => w.key).join(", ");
      console.log("PASS (" + String(result.passed.length) + " assertions, " + String(result.durationMs) + "ms) wrote: " + (keys || "nothing"));
    } else {
      const total = String(result.passed.length + result.failed.length);
      console.log("FAIL (" + String(result.failed.length) + "/" + total + " failed)");
      for (const f of result.failed) {
        const suffix = f.detail ? " — " + f.detail : "";
        console.log("    x " + f.assertion + suffix);
      }
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("ERROR: " + msg);
    return {
      scenario: scenario.name, writes: [],
      passed: [], failed: [{ assertion: "scenario ran without error", passed: false, detail: msg }],
      durationMs: 0,
    };
  }
}

const results: InferenceResult[] = [];
for (const scenario of scenarios) {
  results.push(await runOne(scenario));
}

const totalPassed = results.filter((r) => r.failed.length === 0).length;
const totalFailed = results.filter((r) => r.failed.length > 0).length;
console.log("\nResults: " + String(totalPassed) + " passed, " + String(totalFailed) + " failed out of " + String(results.length) + " scenarios");

// Save results artifact
const artifact = {
  inferenceVersion: INFERENCE_VERSION,
  model: "claude-sonnet-4-20250514",
  timestamp: new Date().toISOString(),
  summary: { total: results.length, passed: totalPassed, failed: totalFailed },
  scenarios: results.map((r) => ({
    name: r.scenario,
    passed: r.failed.length === 0,
    assertions: { passed: r.passed.length, failed: r.failed.length },
    durationMs: r.durationMs,
    writes: r.writes.map((w) => w.key),
    failures: r.failed.map((f) => f.assertion),
  })),
};

const dir = "evals/results";
mkdirSync(dir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
const filename = dir + "/inference-" + INFERENCE_VERSION + "-" + ts + ".json";
writeFileSync(filename, JSON.stringify(artifact, null, 2) + "\n");
console.log("Results saved to " + filename);

if (totalFailed > 0) {
  process.exit(1);
}
