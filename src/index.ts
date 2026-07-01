/*
 * SeamStress — seam-scoped code review engine.
 * Copyright (C) 2026 SeamStress contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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

import { reportFatal } from "./cli.js";
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
  reportFatal("Smoke test failed", err);
  process.exitCode = 1;
});
