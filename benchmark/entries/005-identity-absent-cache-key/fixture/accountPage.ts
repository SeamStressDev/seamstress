import { cacheKey, getCached, setCached } from "./cache";

// Renders a per-user account page (billing address, last-4 of card). Caches it
// under a key with no user identity.
export function renderAccountPage(userId: string, path: string, query: string): unknown {
  const key = cacheKey(path, query);
  const hit = getCached(key);
  if (hit) return hit; // may be ANOTHER user's account page

  const page = { userId, billingAddress: lookupAddress(userId), cardLast4: lookupCard(userId) };
  setCached(key, page);
  return page;
}

function lookupAddress(u: string) { void u; return "…"; }
function lookupCard(u: string) { void u; return "…"; }
