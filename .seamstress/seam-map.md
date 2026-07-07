# Seam map

The engine is a CLI static analyzer: no runtime auth, no tenant data, no customer
money paths. Most of the classic seam criteria do not apply here. What qualifies:

- src/review.ts: starts paid Anthropic API runs; an edit changes what a run spends
- src/llm/retry.ts: retry loop around paid API calls; a retry bug multiplies spend
- src/llm/pricing.ts: cost accounting shown to the user; wrong numbers misstate spend
- benchmark/entries/ and benchmark/scoring/: fixtures and ground truths are scoring
  evidence; edits move goalposts (see the fixture-immutability protocol)

Not on the map, and why: report rendering, detection heuristics, docs, and tests
decide no money, auth, tenant, or deletion outcome; they get normal care, not seam
friction.
