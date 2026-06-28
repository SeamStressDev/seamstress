/**
 * Bounded-concurrency runner. The detector can produce many seams; reviewing
 * them all with `Promise.all` would burst dozens of concurrent API calls and
 * spike cost unpredictably. This caps how many run at once via a fixed worker
 * pool, preserving input order in the results.
 */

/** Default number of seams reviewed concurrently. */
export const DEFAULT_REVIEW_CONCURRENCY = 4;

/**
 * Run `fn` over every item with at most `limit` in flight at once. Results are
 * returned in input order. `fn` rejecting propagates (callers that want
 * per-item isolation must catch inside `fn`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
