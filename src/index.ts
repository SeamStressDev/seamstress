/**
 * Entry point / smoke test.
 *
 * Makes ONE real, cheap model call (trivial prompt to Haiku) and prints the
 * response plus the real token usage and computed cost — proving the API path
 * works end to end, the key is wired, and the COGS primitive returns clean
 * numbers. Run with a real key in `.env`:
 *
 *   npm run smoke
 */

import { loadEnvFile } from "./env.js";
import { DEFAULT_SMOKE_MODEL, LlmClient } from "./llm/index.js";

async function main(): Promise<void> {
  loadEnvFile();

  const client = new LlmClient();

  const { text, usage, stopReason } = await client.callModel({
    model: DEFAULT_SMOKE_MODEL,
    maxTokens: 64,
    purpose: "other",
    messages: [
      { role: "user", content: "Reply with exactly: SeamStress online." },
    ],
  });

  console.log("--- SeamStress smoke test ---");
  console.log(`model:        ${usage.model}`);
  console.log(`stop_reason:  ${stopReason}`);
  console.log(`response:     ${text.trim()}`);
  console.log(`input tokens: ${usage.inputTokens}`);
  console.log(`output tokens:${usage.outputTokens}`);
  console.log(`cache write:  ${usage.cacheCreationInputTokens}`);
  console.log(`cache read:   ${usage.cacheReadInputTokens}`);
  console.log(`cost (USD):   $${usage.costUsd.toFixed(6)}`);
}

main().catch((err: unknown) => {
  console.error("Smoke test failed:");
  console.error(err);
  process.exitCode = 1;
});
