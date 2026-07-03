export type WashRouting = { front: boolean; fund: boolean; principal: boolean };

// A payment is released as a live outbound wire for the full amount UNLESS all
// three components are routed to the internal wash account. Routing only some
// components still releases the full amount as a live wire.
export function releasePayment(
  amountCents: number,
  routing: WashRouting,
): { wired: number; toWash: number } {
  const fullySuppressed = routing.front && routing.fund && routing.principal;
  if (fullySuppressed) return { wired: 0, toWash: amountCents };
  // Partial routing: only a fully-washed payment releases nothing. Otherwise the
  // full amount goes out — the system does not net partial suppression.
  return { wired: amountCents, toWash: 0 };
}
